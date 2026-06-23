import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
  Settings2,
} from "lucide-react";
import ParecerColumnMappingDialog, {
  type ParecerMapping,
  autoSuggestMapping,
  loadSavedMapping,
  saveMappingTemplate,
} from "./ParecerColumnMappingDialog";

// Helpers de parsing (rodam no browser para não estourar memória do worker)
const normHeader = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

function valueFromMapping(
  rec: Record<string, any>,
  mapping: ParecerMapping,
  key: keyof ParecerMapping,
): any {
  const header = mapping[key];
  if (!header) return null;
  const v = rec[header];
  return v === "" || v == null ? null : v;
}

function normalizeCrm(input: any): string | null {
  if (input == null) return null;
  const s = String(input).toUpperCase();
  const m = s.match(/(\d{2,7})\s*[\/\-\s]*([A-Z]{2})/);
  if (m) return `${m[1]}/${m[2]}`;
  const onlyDigits = s.match(/\d{2,7}/);
  if (onlyDigits) return onlyDigits[0];
  return null;
}

function parseExcelDate(v: any): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400 * 1000).toISOString();
  }
  const s = String(v).trim();
  const m = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const [, d, mo, y, h = "0", mi = "0", se = "0"] = m;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(
      Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)),
    );
    return isNaN(+dt) ? null : dt.toISOString();
  }
  const dt = new Date(s);
  return isNaN(+dt) ? null : dt.toISOString();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

type ReportRow = {
  id: string;
  period_start: string;
  period_end: string;
  source_filename: string | null;
  row_count: number;
  imported_at: string;
};

/**
 * Card de Relatório de Parecer — exibido somente em lotes do tipo Parecer.
 * Bloqueia o início da análise enquanto não houver relatório importado e
 * permite cruzar items↔linhas após o upload.
 */
export function ParecerReportCard({
  paymentId,
  competenceMonth,
  competenceMonths,
}: {
  paymentId: string;
  competenceMonth: string | null;
  competenceMonths: string[] | null;
}) {
  const { toast } = useToast();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [crossing, setCrossing] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [parsed, setParsed] = useState<{
    fileHash: string;
    raw: Record<string, any>[];
    headers: string[];
    sampleRow: Record<string, any> | null;
  } | null>(null);

  // Defaults de período baseados na competência do lote
  const defaultStart = (() => {
    const m = competenceMonths?.[0] ?? competenceMonth;
    if (!m) return "";
    return m.slice(0, 10);
  })();
  const defaultEnd = (() => {
    const m =
      competenceMonths?.[competenceMonths.length - 1] ?? competenceMonth;
    if (!m) return "";
    // Parse YYYY-MM-DD em UTC para evitar shift de fuso (BRT -3h vira mês anterior)
    const iso = m.slice(0, 10);
    const [y, mo] = iso.split("-").map(Number);
    if (!y || !mo) return "";
    // último dia do mês em UTC
    const last = new Date(Date.UTC(y, mo, 0));
    return last.toISOString().slice(0, 10);
  })();
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("payment_parecer_reports")
      .select("id,period_start,period_end,source_filename,row_count,imported_at")
      .eq("payment_id", paymentId)
      .order("imported_at", { ascending: false });
    setReports((data ?? []) as ReportRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  /** Helper compartilhado: parser de "Nome (CRM 123/UF)". */
  const splitMedicoCrm = (raw: any): { name: string | null; crm: string | null } => {
    if (raw == null) return { name: null, crm: null };
    const s = String(raw).trim();
    if (!s) return { name: null, crm: null };
    const m = s.match(
      /^(.*?)\s*[\(\[]\s*CRM[^\d]*?(\d{2,7})(?:[\s\/\-]*([A-Z]{2}))?\s*[\)\]]\s*$/i,
    );
    if (m) {
      const name = m[1].trim() || null;
      const crm = m[3] ? `${m[2]}/${m[3].toUpperCase()}` : m[2];
      return { name, crm };
    }
    return { name: s, crm: null };
  };

  /** Passo 1: ler arquivo, extrair headers e abrir diálogo (ou aplicar template salvo). */
  const startUpload = async () => {
    if (!file) {
      toast({ title: "Selecione um arquivo .xls/.xlsx", variant: "destructive" });
      return;
    }
    if (!periodStart || !periodEnd) {
      toast({ title: "Informe o período do relatório", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const hashBytes = new Uint8Array(bytes).slice().buffer;
      const fileHash = await sha256Hex(new Uint8Array(hashBytes));

      const wb = XLSX.read(bytes, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, {
        defval: "",
        raw: false,
      });
      if (!raw.length) throw new Error("Planilha vazia ou sem cabeçalho");

      const headers = Object.keys(raw[0] ?? {});
      const parsedState = { fileHash, raw, headers, sampleRow: raw[0] ?? null };
      setParsed(parsedState);

      // Se já há template salvo para essa assinatura, vai direto.
      const saved = loadSavedMapping(headers);
      if (saved && Object.keys(saved).length > 0) {
        await runImport(saved, parsedState);
      } else {
        setMappingOpen(true);
        setUploading(false);
      }
    } catch (e: any) {
      toast({
        title: "Falha ao ler arquivo",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
      setUploading(false);
    }
  };

  /** Passo 2: aplica mapping + envia para o backend. */
  const runImport = async (
    mapping: ParecerMapping,
    state: NonNullable<typeof parsed>,
  ) => {
    setUploading(true);
    try {
      const { raw, fileHash } = state;
      const rows = raw.map((rec) => {
        const medicoRespRaw = valueFromMapping(rec, mapping, "medico_resposta");
        const { name: medicoResp, crm: crmFromName } = splitMedicoCrm(medicoRespRaw);

        const crmRaw = valueFromMapping(rec, mapping, "crm_resposta");
        const crm = normalizeCrm(crmRaw) ?? crmFromName ?? null;

        const medicoSolicRaw = valueFromMapping(rec, mapping, "medico_solicitante");
        const { name: medicoSolic } = splitMedicoCrm(medicoSolicRaw);

        return {
          atendimento: valueFromMapping(rec, mapping, "atendimento"),
          paciente: valueFromMapping(rec, mapping, "paciente"),
          medico_solicitante: medicoSolic,
          medico_resposta: medicoResp,
          medico_resposta_crm: crm,
          espec_origem: valueFromMapping(rec, mapping, "espec_origem"),
          espec_destino: valueFromMapping(rec, mapping, "espec_destino"),
          dt_solic_parecer: parseExcelDate(
            valueFromMapping(rec, mapping, "dt_solic_parecer"),
          ),
          dt_resposta_parecer: parseExcelDate(
            valueFromMapping(rec, mapping, "dt_resposta_parecer"),
          ),
          situacao: valueFromMapping(rec, mapping, "situacao"),
          raw: rec,
        };
      });

      // 2) Init: cria/encontra cabeçalho (idempotente por hash)
      const initRes = await supabase.functions.invoke("import-parecer-report", {
        body: {
          mode: "init",
          payment_id: paymentId,
          filename: file?.name,
          file_hash: fileHash,
          period_start: periodStart,
          period_end: periodEnd,
        },
      });
      if (initRes.error) {
        const ctx: any = (initRes.error as any)?.context;
        const dup = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
        if (dup?.duplicate) {
          toast({
            title: "Arquivo já importado",
            description: "Este relatório já foi enviado para este lote.",
          });
          await load();
          return;
        }
        throw initRes.error;
      }
      const reportId = (initRes.data as any)?.report_id as string;
      if (!reportId) throw new Error("Falha ao criar cabeçalho do relatório");

      // 3) Append em chunks de 300 linhas
      const CHUNK = 300;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error: appErr } = await supabase.functions.invoke(
          "import-parecer-report",
          { body: { mode: "append", report_id: reportId, rows: chunk } },
        );
        if (appErr) throw appErr;
        inserted += chunk.length;
      }

      // 4) Finaliza
      await supabase.functions.invoke("import-parecer-report", {
        body: { mode: "finalize", report_id: reportId, row_count: inserted },
      });

      if (inserted === 0) {
        toast({
          title: "Relatório sem linhas",
          description:
            "O arquivo foi lido mas nenhuma linha foi reconhecida. Verifique se os cabeçalhos batem com o relatório do Tasy e reimporte.",
          variant: "destructive",
        });
        setFile(null);
        setParsed(null);
        await load();
        return;
      }

      toast({
        title: "Relatório importado",
        description: `${inserted} linhas carregadas.`,
      });
      setFile(null);
      setParsed(null);
      await load();
      await cross();
    } catch (e: any) {
      toast({
        title: "Falha ao importar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };




  const cross = async () => {
    setCrossing(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "cross-reference-parecer",
        { body: { payment_id: paymentId, trigger_reanalysis: true } },
      );
      if (error) throw error;
      const d = data as any;
      toast({
        title: "Cruzamento concluído",
        description: `Confirmados: ${d?.confirmed ?? 0} · Não encontrados: ${
          d?.not_found ?? 0
        } · Auto-tratados: ${d?.auto_applied ?? 0}`,
      });
    } catch (e: any) {
      toast({
        title: "Falha no cruzamento",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setCrossing(false);
    }
  };

  const removeReport = async (reportId: string) => {
    if (!confirm("Remover este relatório? As linhas importadas serão apagadas e você poderá reenviar o arquivo correto.")) return;
    try {
      const { error: rowsErr } = await supabase
        .from("payment_parecer_report_rows")
        .delete()
        .eq("report_id", reportId);
      if (rowsErr) throw rowsErr;
      const { error: hdrErr } = await supabase
        .from("payment_parecer_reports")
        .delete()
        .eq("id", reportId);
      if (hdrErr) throw hdrErr;
      toast({ title: "Relatório removido", description: "Reenvie o arquivo correto." });
      await load();
    } catch (e: any) {
      toast({ title: "Falha ao remover", description: e?.message ?? String(e), variant: "destructive" });
    }
  };


  const hasReport = reports.length > 0;
  const emptyReports = reports.filter((r) => (r.row_count ?? 0) === 0);
  const hasEmpty = emptyReports.length > 0;

  return (
    <Card
      className={
        hasReport
          ? "border-emerald-300/60 bg-emerald-50/30 dark:bg-emerald-950/15"
          : "border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/15"
      }
    >
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Relatório de Parecer (Tasy)
          {hasReport ? (
            <Badge variant="outline" className="border-emerald-400 text-emerald-700">
              <CheckCircle2 className="h-3 w-3 mr-1" /> Importado
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500 text-amber-700">
              <AlertTriangle className="h-3 w-3 mr-1" /> Pendente
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasReport && (
          <p className="text-sm text-muted-foreground">
            Lotes de Parecer exigem o relatório de <em>Parecer Solicitado /
            Respondido</em> do Tasy antes de iniciar a análise. O sistema
            cruza cada item com o relatório para identificar visitas
            sequenciais geradas por parecer.
          </p>
        )}

        {hasEmpty && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div>
              <div className="font-medium text-destructive">
                Relatório sem linhas gravadas
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {emptyReports.length === 1
                  ? `O arquivo "${emptyReports[0].source_filename ?? "(sem nome)"}" foi importado, mas nenhuma linha foi gravada (apenas cabeçalho).`
                  : `${emptyReports.length} relatórios foram importados sem linhas gravadas.`}{" "}
                O cruzamento está bloqueado. Reimporte o arquivo correto antes de iniciar a análise.
              </div>
            </div>
          </div>
        )}

        {hasReport && (
          <ul className="text-sm space-y-1">
            {reports.map((r) => {
              const empty = (r.row_count ?? 0) === 0;
              return (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-2 border-b border-border/40 last:border-0 py-1"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium flex items-center gap-2">
                      {r.source_filename ?? "(sem nome)"}
                      {empty && (
                        <Badge variant="outline" className="border-destructive text-destructive text-[10px]">
                          0 linhas
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.period_start} → {r.period_end} · {r.row_count} linhas
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">
                      {new Date(r.imported_at).toLocaleString()}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeReport(r.id)}
                      title="Remover relatório e reimportar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}


        <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Arquivo (.xls/.xlsx)</Label>
            <Input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
          </div>
          <div>
            <Label className="text-xs">Período início</Label>
            <Input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={uploading}
            />
          </div>
          <div>
            <Label className="text-xs">Período fim</Label>
            <Input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              disabled={uploading}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={upload} disabled={uploading || !file}>
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              Importar
            </Button>
            {hasReport && (
              <Button
                variant="outline"
                onClick={cross}
                disabled={crossing || hasEmpty}
                title={
                  hasEmpty
                    ? "Reimporte o relatório — há arquivos sem linhas gravadas"
                    : "Recruza items × relatórios e reaplica motivos automáticos"
                }
              >
                {crossing ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-1" />
                )}
                Recruzar
              </Button>
            )}
          </div>
        </div>

        {loading && (
          <p className="text-xs text-muted-foreground">Carregando relatórios…</p>
        )}
      </CardContent>
    </Card>
  );
}

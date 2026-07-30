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
import { confirmDialog } from "@/lib/confirm";
import { notify } from "@/lib/uiSignals";
import { cn } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";

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

// Detecta MDY vs DMY varrendo todos os valores da(s) coluna(s) de data.
// Tasy às vezes exporta MM/DD/YYYY (americano) e outras vezes DD/MM/YYYY.
// Se algum valor tem o 1º bloco > 12, é DMY definitivo; se algum tem o 2º
// bloco > 12, é MDY definitivo. Sem evidência, default DMY (Brasil).
function inferDateOrder(values: any[]): "dmy" | "mdy" {
  let dmyOk = true;
  let mdyOk = true;
  for (const v of values) {
    if (v == null || v === "") continue;
    if (v instanceof Date || typeof v === "number") continue;
    const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12) mdyOk = false;
    if (b > 12) dmyOk = false;
  }
  if (!dmyOk && mdyOk) return "mdy";
  return "dmy";
}

/**
 * Parser de data do relatório de parecer — SEMPRE data pura, hora zerada.
 *
 * Por quê: a hora nasce corrompida no próprio arquivo do Tasy (a máscara do
 * relatório usa o MÊS na posição do minuto e a hora só varia de 1 a 12, sem
 * AM/PM). Não há como recuperar a hora real em código, e hora errada é pior
 * que hora ausente porque faz a data virar o dia. A única informação temporal
 * confiável do relatório é a coluna "Tempo resposta", capturada à parte.
 */
function parseExcelDate(v: any, order: "dmy" | "mdy" = "dmy"): string | null {
  if (v == null || v === "") return null;
  const isoDay = (y: number, mo1: number, d: number) => {
    const dt = new Date(Date.UTC(y, mo1 - 1, d, 0, 0, 0));
    return isNaN(+dt) ? null : dt.toISOString();
  };
  if (v instanceof Date) return isoDay(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + Math.floor(v) * 86400 * 1000);
    return isNaN(+dt) ? null : isoDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const [, p1, p2, y] = m;
    const d = order === "mdy" ? p2 : p1;
    const mo = order === "mdy" ? p1 : p2;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return isoDay(year, Number(mo), Number(d));
  }
  const dt = new Date(s);
  if (isNaN(+dt)) return null;
  return isoDay(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
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
  cross_summary: {
    parecer_confirmed?: number | null;
    parecer_unverified?: number | null;
    visitas?: number | null;
    finished_at?: string | null;
  } | null;
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

  // Período é AUTO-DETECTADO das datas do arquivo durante o parse.
  // Vale para produção e remessa — analista nunca preenche manualmente.
  // Mantemos fallback baseado na competência só pra exibir algo razoável caso
  // o arquivo não tenha datas válidas (raríssimo).
  const fallbackStart = (() => {
    const m = competenceMonths?.[0] ?? competenceMonth;
    return m ? m.slice(0, 10) : "";
  })();
  const fallbackEnd = (() => {
    const m = competenceMonths?.[competenceMonths.length - 1] ?? competenceMonth;
    if (!m) return "";
    const iso = m.slice(0, 10);
    const [y, mo] = iso.split("-").map(Number);
    if (!y || !mo) return "";
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  })();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("payment_parecer_reports")
      .select("id,period_start,period_end,source_filename,row_count,imported_at,cross_summary")
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
    // Período é auto-detectado das datas do arquivo após o parse — sem validação manual aqui.
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

      // Sempre abre o diálogo de mapping para o analista revisar/confirmar
      // (mesmo que haja template salvo) — evita aplicar mapping errado silenciosamente.
      setMappingOpen(true);
      setUploading(false);
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
      const dateOrder = inferDateOrder([
        ...raw.map((rec) => valueFromMapping(rec, mapping, "dt_solic_parecer")),
        ...raw.map((rec) => valueFromMapping(rec, mapping, "dt_resposta_parecer")),
      ]);
      console.log(`[ParecerReport] date order detected: ${dateOrder}`);
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
            dateOrder,
          ),
          dt_resposta_parecer: parseExcelDate(
            valueFromMapping(rec, mapping, "dt_resposta_parecer"),
            dateOrder,
          ),
          situacao: valueFromMapping(rec, mapping, "situacao"),
          raw: rec,
        };
      });

      // Auto-detecta período do arquivo: min/max de dt_solic e dt_resposta.
      // Fallback à competência do lote só quando o arquivo não tem datas válidas.
      const allDates = rows
        .flatMap((r) => [r.dt_solic_parecer, r.dt_resposta_parecer])
        .filter((d): d is string => !!d);
      const isoDays = allDates.map((d) => d.slice(0, 10)).sort();
      const periodStart = isoDays[0] ?? fallbackStart;
      const periodEnd = isoDays[isoDays.length - 1] ?? fallbackEnd;
      console.log(`[ParecerReport] period auto-detected: ${periodStart} → ${periodEnd}`);

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
      // A função roda em background (evita IDLE_TIMEOUT) e responde 202 com
      // { accepted: true, background: true } SEM os contadores. Só quando vier
      // a resposta síncrona (modo legado) é que mostramos os números.
      if (d?.background || d?.accepted) {
        toast({
          title: "Cruzamento em andamento",
          description:
            "O cruzamento com o relatório do Tasy está rodando em segundo plano. Atualize a página em alguns segundos para ver os itens classificados como Parecer/Visita.",
        });
      } else {
        toast({
          title: "Cruzamento concluído",
          description: `Confirmados: ${d?.confirmed ?? 0} · Não encontrados: ${
            d?.not_found ?? 0
          } · Auto-tratados: ${d?.auto_applied ?? 0}`,
        });
      }
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
    const report = reports.find((r) => r.id === reportId);
    const filename = report?.source_filename ?? "(sem nome)";
    const rowCount = report?.row_count ?? 0;

    const ok = await confirmDialog({
      title: "Remover relatório de parecer?",
      description: (
        <>
          O arquivo <strong>{filename}</strong> ({rowCount} linha{rowCount === 1 ? "" : "s"}) será
          apagado do banco junto com todas as linhas importadas. Esta ação não pode ser desfeita.
        </>
      ),
      tone: "danger",
      confirmText: "Remover relatório",
      cancelText: "Manter",
    });
    if (!ok) return;

    try {
      const { error } = await supabase.functions.invoke("delete-parecer-report", {
        body: { report_id: reportId },
      });
      if (error) throw error;

      // Confirma no banco que o registro realmente sumiu antes de avisar sucesso.
      const { data: stillThere, error: checkErr } = await supabase
        .from("payment_parecer_reports")
        .select("id")
        .eq("id", reportId)
        .maybeSingle();
      if (checkErr) throw checkErr;
      if (stillThere) {
        throw new Error(
          "O servidor respondeu sucesso, mas o relatório ainda existe no banco. Tente novamente ou contate o suporte.",
        );
      }

      await load();
      notify.success("Relatório removido", {
        description: `"${filename}" foi apagado. Reenvie o arquivo correto para continuar.`,
      });
    } catch (e: any) {
      await load(); // garante que UI reflete o estado real mesmo em erro
      notify.error("Falha ao remover relatório", {
        description: e?.message ?? String(e),
      });
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
                      {new Date(r.imported_at).toLocaleString("pt-BR")}
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

        {hasReport && (() => {
          const latest = reports.find((r) => r.cross_summary);
          const cs = latest?.cross_summary;
          if (!cs) return null;
          const confirmed = Number(cs.parecer_confirmed ?? 0);
          const unverified = Number(cs.parecer_unverified ?? 0);
          const visitas = Number(cs.visitas ?? 0);
          return (
            <div className="rounded-md border bg-muted/20 p-3 text-xs">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Resumo do cruzamento
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-400 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30">
                  {confirmed} confirmado{confirmed === 1 ? "" : "s"}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    unverified > 0
                      ? "border-amber-500 text-amber-800 bg-amber-50 dark:bg-amber-950/30"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {unverified} sem registro{unverified > 0 ? " · analista decide" : ""}
                </Badge>
                <Badge variant="outline">
                  {visitas} visita{visitas === 1 ? "" : "s"}
                </Badge>
              </div>
            </div>
          );
        })()}





        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 items-end">
          <div>
            <Label className="text-xs">Arquivo (.xls/.xlsx)</Label>
            <Input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              O período do relatório é detectado automaticamente das datas do arquivo — pode subir base de qualquer janela (mensal, anual etc.).
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={startUpload} disabled={uploading || !file}>
              {uploading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              Importar
            </Button>
            {file && parsed && (
              <Button
                variant="outline"
                onClick={() => setMappingOpen(true)}
                disabled={uploading}
                title="Ajustar mapeamento de colunas"
              >
                <Settings2 className="h-4 w-4 mr-1" />
                Mapeamento
              </Button>
            )}
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

      {parsed && (
        <ParecerColumnMappingDialog
          open={mappingOpen}
          onOpenChange={setMappingOpen}
          fileName={file?.name ?? ""}
          headers={parsed.headers}
          sampleRow={parsed.sampleRow}
          onApply={async (mapping, persist) => {
            if (persist) saveMappingTemplate(parsed.headers, mapping);
            setMappingOpen(false);
            await runImport(mapping, parsed);
          }}
        />
      )}
    </Card>
  );
}

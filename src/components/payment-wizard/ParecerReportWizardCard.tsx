import { useState } from "react";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FileText, Upload, CheckCircle2, AlertTriangle, Loader2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ParecerColumnMappingDialog, {
  type ParecerMapping,
} from "@/components/payment-detail/ParecerColumnMappingDialog";

const normalizeCrm = (input: any): string | null => {
  if (input == null) return null;
  const s = String(input).toUpperCase();
  const m = s.match(/(\d{2,7})\s*[\/\-\s]*([A-Z]{2})/);
  if (m) return `${m[1]}/${m[2]}`;
  const d = s.match(/\d{2,7}/);
  return d ? d[0] : null;
};

const inferDateOrder = (values: any[]): "dmy" | "mdy" => {
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
};

const parseExcelDate = (v: any, order: "dmy" | "mdy" = "dmy"): string | null => {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400 * 1000).toISOString();
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, p1, p2, y, h = "0", mi = "0", se = "0"] = m;
    const d = order === "mdy" ? p2 : p1;
    const mo = order === "mdy" ? p1 : p2;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const dt = new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se)));
    return isNaN(+dt) ? null : dt.toISOString();
  }
  const dt = new Date(s);
  return isNaN(+dt) ? null : dt.toISOString();
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const buf = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const splitMedicoCrm = (raw: any): { name: string | null; crm: string | null } => {
  if (raw == null) return { name: null, crm: null };
  const s = String(raw).trim();
  if (!s) return { name: null, crm: null };
  const m = s.match(/^(.*?)\s*[\(\[]\s*CRM[^\d]*?(\d{2,7})(?:[\s\/\-]*([A-Z]{2}))?\s*[\)\]]\s*$/i);
  if (m) {
    const name = m[1].trim() || null;
    const crm = m[3] ? `${m[2]}/${m[3].toUpperCase()}` : m[2];
    return { name, crm };
  }
  return { name: s, crm: null };
};

const onlyDigits = (s: any) => String(s ?? "").replace(/\D+/g, "");
const norm = (s: any) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export type ParecerWizardPayload = {
  fileName: string;
  fileHash: string;
  periodStart: string;
  periodEnd: string;
  rows: Array<{
    atendimento: any;
    paciente: any;
    medico_solicitante: string | null;
    medico_resposta: string | null;
    medico_resposta_crm: string | null;
    espec_origem: any;
    espec_destino: any;
    dt_solic_parecer: string | null;
    dt_resposta_parecer: string | null;
    situacao: any;
    raw: Record<string, any>;
  }>;
};

export function ParecerReportWizardCard({
  competenceMonths,
  tasyAttendanceKeys,
  value,
  onChange,
}: {
  competenceMonths: string[];
  /** Set de chaves "atendimento|crm" e "atendimento|nome" da base Tasy para preview de match */
  tasyAttendanceKeys: { byCrm: Set<string>; byName: Set<string> } | null;
  value: ParecerWizardPayload | null;
  onChange: (v: ParecerWizardPayload | null) => void;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [parseState, setParseState] = useState<{
    raw: Record<string, any>[];
    headers: string[];
    sampleRow: Record<string, any> | null;
    fileHash: string;
  } | null>(null);

  const sortedMonths = [...competenceMonths].sort();
  const defaultStart = sortedMonths[0] ? `${sortedMonths[0]}-01` : "";
  const defaultEnd = (() => {
    const m = sortedMonths[sortedMonths.length - 1];
    if (!m) return "";
    const [y, mo] = m.split("-").map(Number);
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  })();
  const [periodStart, setPeriodStart] = useState(defaultStart);
  const [periodEnd, setPeriodEnd] = useState(defaultEnd);

  const startParse = async () => {
    if (!file) return;
    if (!periodStart || !periodEnd) {
      toast({ title: "Informe o período do relatório", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      const fileHash = await sha256Hex(bytes);
      const wb = XLSX.read(bytes, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
      if (!raw.length) throw new Error("Planilha vazia ou sem cabeçalho");
      const headers = Object.keys(raw[0] ?? {});
      setParseState({ raw, headers, sampleRow: raw[0] ?? null, fileHash });
      setMappingOpen(true);
    } catch (e: any) {
      toast({ title: "Falha ao ler arquivo", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const applyMapping = async (mapping: ParecerMapping) => {
    if (!parseState || !file) return;
    const valFrom = (rec: Record<string, any>, key: keyof ParecerMapping) => {
      const h = mapping[key];
      if (!h) return null;
      const v = rec[h];
      return v === "" || v == null ? null : v;
    };
    const rows = parseState.raw.map((rec) => {
      const medicoRespRaw = valFrom(rec, "medico_resposta");
      const { name: medicoResp, crm: crmFromName } = splitMedicoCrm(medicoRespRaw);
      const crm = normalizeCrm(valFrom(rec, "crm_resposta")) ?? crmFromName ?? null;
      const { name: medicoSolic } = splitMedicoCrm(valFrom(rec, "medico_solicitante"));
      return {
        atendimento: valFrom(rec, "atendimento"),
        paciente: valFrom(rec, "paciente"),
        medico_solicitante: medicoSolic,
        medico_resposta: medicoResp,
        medico_resposta_crm: crm,
        espec_origem: valFrom(rec, "espec_origem"),
        espec_destino: valFrom(rec, "espec_destino"),
        dt_solic_parecer: parseExcelDate(valFrom(rec, "dt_solic_parecer")),
        dt_resposta_parecer: parseExcelDate(valFrom(rec, "dt_resposta_parecer")),
        situacao: valFrom(rec, "situacao"),
        raw: rec,
      };
    });
    onChange({
      fileName: file.name,
      fileHash: parseState.fileHash,
      periodStart,
      periodEnd,
      rows,
    });
    setMappingOpen(false);
    toast({ title: "Relatório de parecer pronto", description: `${rows.length} linhas carregadas.` });
  };

  const clear = () => {
    setFile(null);
    setParseState(null);
    onChange(null);
  };

  // Pré-match contra Tasy
  const matchPreview = (() => {
    if (!value || !tasyAttendanceKeys) return null;
    let matched = 0;
    for (const r of value.rows) {
      const att = onlyDigits(r.atendimento);
      if (!att) continue;
      const crmD = onlyDigits(r.medico_resposta_crm);
      const nm = norm(r.medico_resposta);
      if (crmD && tasyAttendanceKeys.byCrm.has(`${att}|${crmD}`)) {
        matched++;
        continue;
      }
      if (nm && tasyAttendanceKeys.byName.has(`${att}|${nm}`)) {
        matched++;
      }
    }
    return matched;
  })();

  return (
    <Card className="border-warning/40">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Relatório de Pareceres (Tasy)
          <Badge variant="outline" className="ml-1">Obrigatório</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Em confecção de Parecer, o sistema cruza a base Tasy com o relatório de pareceres para classificar
          cada atendimento como <strong>Parecer confirmado</strong> ou <strong>Visita</strong> antes de calcular o repasse.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {value ? (
          <div className="rounded-md border bg-success/5 p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <span className="truncate">{value.fileName}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {value.rows.length} linhas · {value.periodStart} a {value.periodEnd}
                </div>
                {matchPreview != null && (
                  <div className="text-xs mt-1">
                    <span className="text-success font-medium">{matchPreview}</span> linha(s) com match na base Tasy ·{" "}
                    <span className="text-muted-foreground">{value.rows.length - matchPreview} sem match (vão como visita)</span>
                  </div>
                )}
              </div>
              <Button size="sm" variant="ghost" onClick={clear} title="Remover">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Período início</Label>
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Período fim</Label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".xls,.xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button onClick={startParse} disabled={!file || loading} size="sm">
                {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                Ler arquivo
              </Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              Use o relatório "Parecer Solicitado/Respondido" do Tasy no formato .xls/.xlsx.
            </p>
          </>
        )}
      </CardContent>

      {parseState && (
        <ParecerColumnMappingDialog
          open={mappingOpen}
          onOpenChange={setMappingOpen}
          fileName={file?.name ?? ""}
          headers={parseState.headers}
          sampleRow={parseState.sampleRow}
          onApply={(mapping) => { void applyMapping(mapping); }}
        />
      )}
    </Card>
  );
}

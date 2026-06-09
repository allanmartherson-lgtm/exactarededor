import { useEffect, useMemo, useState, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertCircleIcon, FileSpreadsheetIcon } from "lucide-react";

export type TargetField = {
  key: string;
  label: string;
  required: boolean;
  aliases: string[];
};

export type MappedDraft = {
  attendance: string;
  tuss_code: string;
  procedure_date: string;
  patient_name: string;
  function_label: string;
  claimed_amount: string;
  claimed_quantity: string;
  procedure_name: string;
  doctor_hint: string;
  company_hint: string;
};

type RawRow = Record<string, unknown>;

const DEFAULT_TARGETS: TargetField[] = [
  { key: "attendance", label: "Atendimento", required: true, aliases: ["atendiment", "atend", "guia", "natendimento", "nratendimento"] },
  { key: "tuss_code", label: "TUSS / Cód. procedimento", required: true, aliases: ["tuss", "codtuss", "codprocedi", "procedimentocodig", "codigoprocedimento", "codigo"] },
  { key: "claimed_amount", label: "Valor alegado", required: true, aliases: ["valoralegado", "valorpago", "valorprocedi", "vlrpago", "vlrprocedi", "valor", "vlr"] },
  { key: "claimed_quantity", label: "Quantidade", required: false, aliases: ["quantidade", "qtd", "qtde", "qtditem", "qt"] },
  { key: "procedure_date", label: "Data procedimento", required: false, aliases: ["datacir", "dataprocedi", "datacirurgia", "dataetapa", "data"] },
  { key: "patient_name", label: "Paciente", required: false, aliases: ["paciente", "nomepaciente", "nmpaciente", "nome"] },
  { key: "function_label", label: "Função médico", required: false, aliases: ["funcao", "funcaomedico", "papel", "role", "tipoatuacao"] },
  { key: "doctor_hint", label: "Médico (nome/CRM)", required: false, aliases: ["medico", "nomemedico", "executante", "executor", "crm", "crmexecutor", "medicoexec"] },
  { key: "company_hint", label: "PJ / Empresa", required: false, aliases: ["empresa", "terceiro", "razaosocial", "cnpj", "fornecedor"] },
  { key: "procedure_name", label: "Nome do procedimento", required: false, aliases: ["procedimentomatmed", "descricao", "descrprocedi", "procedimento", "nomeprocedimento", "descproc", "grupo", "matmed"] },
];

const NONE = "__none__";
const EXCLUDE_REGEX = /(visita|parecer|consulta)/i;

function normKey(k: string): string {
  return k
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function autoSuggest(headers: string[], targets: TargetField[]): Record<string, string> {
  const norm = headers.map((h) => ({ h, n: normKey(h) }));
  const out: Record<string, string> = {};
  for (const t of targets) {
    const hit = norm.find(({ n }) => t.aliases.some((a) => n.includes(a)));
    if (hit) out[t.key] = hit.h;
  }
  return out;
}

function parseCellMoney(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return String(v);
  return String(v)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
}

function parseCellDate(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    const epoch = new Date(Math.round((v - 25569) * 86400 * 1000));
    return epoch.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[2]}-${m[1]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return "";
}

export async function readRawSheet(file: File): Promise<{ headers: string[]; rows: RawRow[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "" });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

/** Build a raw mapped row coercing date/money fields where applicable. */
function buildRow(
  raw: RawRow,
  mapping: Record<string, string>,
  targets: TargetField[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of targets) {
    const col = mapping[t.key];
    const v = !col || col === NONE ? "" : raw[col];
    if (/data/i.test(t.label) || t.key.endsWith("_data") || t.key === "procedure_date") {
      out[t.key] = parseCellDate(v);
    } else if (/valor|amount|qtd|quantidade|unit/i.test(t.label) || /valor|qtd|amount/.test(t.key)) {
      out[t.key] = parseCellMoney(v);
    } else if (t.key === "tuss_code" || t.key === "tasy_tuss" || t.key === "pag_tuss") {
      out[t.key] = String(v ?? "").replace(/\D/g, "").slice(0, 8);
    } else {
      out[t.key] = String(v ?? "").trim();
    }
  }
  return out;
}

export type MappingWizardProps = {
  open: boolean;
  fileName: string;
  headers: string[];
  rows: RawRow[];
  /** Custom field schema. Defaults to the original "alegação" schema (MappedDraft keys). */
  targets?: TargetField[];
  /** Initial column mapping suggestion (e.g. reusing a previous file's mapping). */
  initialMapping?: Record<string, string>;
  /** Toggle to show the "exclude visita/parecer/consulta" filter (default true). */
  showExcludeConsultas?: boolean;
  /** Extra controls rendered below the mapping grid (e.g. TUSS exclude list). */
  extraConfig?: ReactNode;
  /** Title shown in the dialog header (default "Mapear colunas da planilha"). */
  dialogTitle?: string;
  onCancel: () => void;
  onConfirm: (
    drafts: Record<string, string>[],
    meta: { mapping: Record<string, string> },
  ) => void;
};

export default function RetroactiveMappingWizard({
  open,
  fileName,
  headers,
  rows,
  targets = DEFAULT_TARGETS,
  initialMapping,
  showExcludeConsultas = true,
  extraConfig,
  dialogTitle = "Mapear colunas da planilha",
  onCancel,
  onConfirm,
}: MappingWizardProps) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [excludeConsultas, setExcludeConsultas] = useState(true);

  useEffect(() => {
    if (open) {
      const auto = autoSuggest(headers, targets);
      const seed: Record<string, string> = { ...auto };
      if (initialMapping) {
        for (const [k, v] of Object.entries(initialMapping)) {
          if (v && headers.includes(v)) seed[k] = v;
        }
      }
      setMapping(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, headers]);

  const preview = useMemo(() => rows.slice(0, 3), [rows]);

  const { valid, dropped, excluded } = useMemo(() => {
    if (Object.keys(mapping).length === 0) return { valid: [] as Record<string, string>[], dropped: 0, excluded: 0 };
    const descKey = targets.find((t) => /procedure_name|procedimento|descricao/i.test(t.key))?.key;
    const descCol = descKey ? mapping[descKey] : undefined;
    let excludedCount = 0;
    const built: Record<string, string>[] = [];
    let droppedCount = 0;
    const requiredKeys = targets.filter((t) => t.required).map((t) => t.key);
    for (const r of rows) {
      if (showExcludeConsultas && excludeConsultas && descCol && descCol !== NONE) {
        const desc = String(r[descCol] ?? "");
        if (EXCLUDE_REGEX.test(desc)) {
          excludedCount++;
          continue;
        }
      }
      const d = buildRow(r, mapping, targets);
      const hasRequired = requiredKeys.every((k) => d[k]);
      if (hasRequired) built.push(d);
      else droppedCount++;
    }
    return { valid: built, dropped: droppedCount, excluded: excludedCount };
  }, [rows, mapping, excludeConsultas, targets, showExcludeConsultas]);

  const missingRequired = targets.filter(
    (t) => t.required && (!mapping[t.key] || mapping[t.key] === NONE),
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheetIcon className="h-4 w-4" />
            {dialogTitle}
          </DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-medium text-foreground">{fileName}</span> · {rows.length} linhas · {headers.length} colunas
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-w-0">
          {headers.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <AlertCircleIcon className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              <div>
                Não encontramos colunas na primeira aba da planilha. Verifique se a primeira linha contém os títulos.
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Mapeamento de colunas
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2.5">
                  {targets.map((t) => (
                    <div key={t.key} className="min-w-0">
                      <Label className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1">
                        <span className="truncate">{t.label}</span>
                        {t.required && <span className="text-destructive">*</span>}
                      </Label>
                      <Select
                        value={mapping[t.key] ?? NONE}
                        onValueChange={(v) => setMapping((m) => ({ ...m, [t.key]: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs w-full">
                          <SelectValue placeholder="Selecione…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>— Não mapear —</SelectItem>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {showExcludeConsultas && (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                  <Checkbox
                    id="rt-exclude-consultas"
                    checked={excludeConsultas}
                    onCheckedChange={(c) => setExcludeConsultas(c === true)}
                  />
                  <label htmlFor="rt-exclude-consultas" className="text-xs cursor-pointer leading-tight">
                    Excluir <strong>visitas, pareceres e consultas</strong> da apuração
                    <span className="text-muted-foreground"> — filtra pela coluna de descrição quando mapeada</span>
                  </label>
                </div>
              )}

              {extraConfig}

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Pré-visualização (3 primeiras linhas)
                </div>
                <div className="rounded-md border border-border overflow-x-auto max-h-44">
                  <table className="text-[11px] w-max min-w-full">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        {headers.map((h) => (
                          <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap max-w-[180px] truncate">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="hover:bg-muted/30">
                          {headers.map((h) => (
                            <td key={h} className="px-2 py-1 border-b border-border/40 whitespace-nowrap max-w-[180px] truncate">
                              {String(r[h] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <Badge variant="default" className="text-[10px]">{valid.length} válidas</Badge>
                {excluded > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {excluded} excluídas (visita/parecer/consulta)
                  </Badge>
                )}
                {dropped > 0 && (
                  <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">
                    {dropped} descartadas (faltando dados)
                  </Badge>
                )}
                {missingRequired.length > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    Faltando: {missingRequired.map((t) => t.label).join(", ")}
                  </Badge>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 p-4 border-t bg-muted/10">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button
            size="sm"
            onClick={() => onConfirm(valid, { mapping })}
            disabled={valid.length === 0 || missingRequired.length > 0}
          >
            Confirmar e adicionar {valid.length} linha(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Field schemas for the "TASY vs Repasse" mode. */
export const TASY_TARGETS: TargetField[] = [
  { key: "tasy_atendimento", label: "Número do atendimento", required: true, aliases: ["atendiment", "atend", "guia", "natendimento", "nratendimento"] },
  { key: "tasy_tuss", label: "Código TUSS (8 dígitos)", required: true, aliases: ["tuss", "codtuss", "codprocedi", "codigoprocedimento", "codigo"] },
  { key: "tasy_qtd", label: "Quantidade", required: true, aliases: ["quantidade", "qtd", "qtde", "qtditem"] },
  { key: "tasy_valor_unit", label: "Valor unitário (base 100%)", required: true, aliases: ["valorunit", "valorunitario", "vlrunit", "vlrunitario", "unitario", "valor"] },
  { key: "tasy_procedimento", label: "Descrição do procedimento", required: false, aliases: ["procedimento", "descricao", "descrprocedi", "nomeprocedimento", "matmed"] },
  { key: "tasy_paciente", label: "Nome do paciente", required: false, aliases: ["paciente", "nomepaciente", "nmpaciente"] },
  { key: "tasy_data", label: "Data do procedimento", required: false, aliases: ["datacir", "dataprocedi", "datacirurgia", "data"] },
  { key: "tasy_convenio", label: "Convênio", required: false, aliases: ["convenio", "plano", "operadora"] },
  { key: "tasy_medico", label: "Médico executante", required: false, aliases: ["medico", "executante", "executor", "nomemedico"] },
  { key: "tasy_funcao", label: "Função", required: false, aliases: ["funcao", "papel"] },
];

export const REPASSE_TARGETS: TargetField[] = [
  { key: "pag_atendimento", label: "Número do atendimento", required: true, aliases: ["atendiment", "atend", "guia", "natendimento"] },
  { key: "pag_tuss", label: "Código do procedimento", required: true, aliases: ["tuss", "codtuss", "codprocedi", "codigo"] },
  { key: "pag_qtd", label: "Quantidade", required: true, aliases: ["quantidade", "qtd", "qtde"] },
  { key: "pag_valor_base", label: "Valor base (sem acordo)", required: true, aliases: ["valorbase", "valorconvenio", "valortabela", "base", "valor"] },
  { key: "pag_valor_com_acordo", label: "Valor com acordo (só exibição)", required: false, aliases: ["valoracordo", "valorcomacordo", "valorrepasse", "valorpago", "liquido"] },
  { key: "pag_funcao", label: "Função do médico", required: false, aliases: ["funcao", "papel"] },
  { key: "pag_medico", label: "Nome do médico", required: false, aliases: ["medico", "executante", "executor"] },
  { key: "pag_data", label: "Data", required: false, aliases: ["data", "datapagamento", "datacir"] },
  { key: "pag_paciente", label: "Paciente", required: false, aliases: ["paciente", "nomepaciente"] },
  { key: "pag_convenio", label: "Convênio", required: false, aliases: ["convenio", "plano", "operadora"] },
];

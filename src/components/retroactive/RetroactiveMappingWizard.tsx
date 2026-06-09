import { useEffect, useMemo, useState } from "react";
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
import { AlertCircleIcon, FileSpreadsheetIcon } from "lucide-react";

export type MappedDraft = {
  attendance: string;
  tuss_code: string;
  procedure_date: string;
  patient_name: string;
  function_label: string;
  claimed_amount: string;
  doctor_hint: string;
  company_hint: string;
};

type RawRow = Record<string, unknown>;

type TargetField = {
  key: keyof MappedDraft;
  label: string;
  required: boolean;
  aliases: string[];
};

const TARGETS: TargetField[] = [
  { key: "attendance", label: "Atendimento", required: true, aliases: ["atendiment", "atend", "guia", "natendimento", "nratendimento"] },
  { key: "tuss_code", label: "TUSS / Código procedimento", required: true, aliases: ["tuss", "codtuss", "codprocedi", "procedimentocodig", "codigoprocedimento", "codigo"] },
  { key: "claimed_amount", label: "Valor alegado", required: true, aliases: ["valoralegado", "valorpago", "valorprocedi", "vlrpago", "vlrprocedi", "valor", "vlr"] },
  { key: "procedure_date", label: "Data do procedimento", required: false, aliases: ["datacir", "dataprocedi", "datacirurgia", "data"] },
  { key: "patient_name", label: "Paciente", required: false, aliases: ["paciente", "nomepaciente", "nmpaciente"] },
  { key: "function_label", label: "Função do médico", required: false, aliases: ["funcao", "funcaomedico", "papel", "role", "tipoatuacao"] },
  { key: "doctor_hint", label: "Médico (nome ou CRM)", required: false, aliases: ["medico", "nomemedico", "executante", "executor", "crm", "crmexecutor"] },
  { key: "company_hint", label: "PJ / Empresa", required: false, aliases: ["empresa", "terceiro", "razaosocial", "cnpj", "fornecedor"] },
];

const NONE = "__none__";

function normKey(k: string): string {
  return k
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function autoSuggest(headers: string[]): Record<string, string> {
  const norm = headers.map((h) => ({ h, n: normKey(h) }));
  const out: Record<string, string> = {};
  for (const t of TARGETS) {
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
  const m = s.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})$/);
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

export default function RetroactiveMappingWizard({
  open,
  fileName,
  headers,
  rows,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  fileName: string;
  headers: string[];
  rows: RawRow[];
  onCancel: () => void;
  onConfirm: (drafts: MappedDraft[]) => void;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) setMapping(autoSuggest(headers));
  }, [open, headers]);

  const preview = useMemo(() => rows.slice(0, 3), [rows]);

  const built = useMemo<MappedDraft[]>(() => {
    if (Object.keys(mapping).length === 0) return [];
    return rows.map((r) => {
      const get = (k: keyof MappedDraft): unknown => {
        const col = mapping[k];
        if (!col || col === NONE) return "";
        return r[col];
      };
      return {
        attendance: String(get("attendance") ?? "").trim(),
        tuss_code: String(get("tuss_code") ?? "").replace(/\D/g, "").slice(0, 8),
        claimed_amount: parseCellMoney(get("claimed_amount")),
        procedure_date: parseCellDate(get("procedure_date")),
        patient_name: String(get("patient_name") ?? "").trim(),
        function_label: String(get("function_label") ?? "").trim(),
        doctor_hint: String(get("doctor_hint") ?? "").trim(),
        company_hint: String(get("company_hint") ?? "").trim(),
      };
    });
  }, [rows, mapping]);

  const valid = useMemo(
    () => built.filter((d) => d.attendance && d.tuss_code && d.claimed_amount),
    [built],
  );
  const dropped = built.length - valid.length;

  const missingRequired = TARGETS.filter((t) => t.required && (!mapping[t.key] || mapping[t.key] === NONE));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheetIcon className="h-4 w-4" />
            Mapear colunas da planilha
          </DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-medium text-foreground">{fileName}</span> · {rows.length} linhas · {headers.length} colunas
          </DialogDescription>
        </DialogHeader>

        {headers.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <AlertCircleIcon className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
            <div>
              Não encontramos colunas na primeira aba da planilha. Verifique se a primeira linha contém os títulos.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Mapeamento de colunas
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2.5">
                {TARGETS.map((t) => (
                  <div key={t.key} className="min-w-0">
                    <Label className="text-[11px] text-muted-foreground flex items-center gap-1 mb-1">
                      <span className="truncate">{t.label}</span>
                      {t.required && <span className="text-destructive">*</span>}
                    </Label>
                    <Select
                      value={mapping[t.key] ?? NONE}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [t.key]: v }))}
                    >
                      <SelectTrigger className="h-8 text-xs">
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

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Pré-visualização (3 primeiras linhas)
              </div>
              <div className="rounded-md border border-border overflow-x-auto max-h-48">
                <table className="text-[11px] w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      {headers.map((h) => (
                        <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        {headers.map((h) => (
                          <td key={h} className="px-2 py-1 border-b border-border/40 whitespace-nowrap">
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
              {dropped > 0 && (
                <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700">
                  {dropped} descartadas
                </Badge>
              )}
              {missingRequired.length > 0 && (
                <Badge variant="destructive" className="text-[10px]">
                  Faltando: {missingRequired.map((t) => t.label).join(", ")}
                </Badge>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
          <Button
            size="sm"
            onClick={() => onConfirm(valid)}
            disabled={valid.length === 0 || missingRequired.length > 0}
          >
            Confirmar e adicionar {valid.length} linha(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


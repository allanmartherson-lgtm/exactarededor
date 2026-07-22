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
import { AlertCircleIcon, FileSpreadsheetIcon, ArrowLeftIcon } from "lucide-react";
import { CompanyMappingList, type MappingRow } from "@/components/shared/CompanyMappingList";
import { findCompanyMatch, buildCompanyIndex, type AliasMap } from "@/lib/companyMatching";
import { preserveFormattedBrazilianNumbers } from "@/lib/parsePaymentFile";

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
  const used = new Set<string>();
  for (const t of targets) {
    // Prioridade importa: itera aliases em ordem e para cada alias procura o
    // primeiro header que contenha o alias. Sem isso, um header genérico como
    // "Valor Convênio" ganhava do específico "Valor Total" só por vir antes na
    // planilha — causando confusão entre colunas com o mesmo prefixo.
    let picked: string | null = null;
    for (const a of t.aliases) {
      const exact = norm.find(({ h, n }) => !used.has(h) && n === a);
      if (exact) { picked = exact.h; break; }
      const partial = norm.find(({ h, n }) => !used.has(h) && n.includes(a));
      if (partial) { picked = partial.h; break; }
    }
    if (picked) {
      out[t.key] = picked;
      used.add(picked);
    }
  }
  return out;
}

export function parseCellMoney(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "number") return String(v);
  const raw = String(v).trim();
  const sign = raw.includes("-") ? "-" : "";
  const cleaned = raw.replace(/[^\d,.]/g, "");
  if (!cleaned) return "";

  // Regra do domínio: TODO valor monetário é BRL. Vírgula é sempre decimal,
  // ponto é sempre separador de milhar. Isso elimina ambiguidades típicas
  // de TASY (ex.: "629.765" = 629.765, não 629,765; "50.000,00" = 50000).
  const lastComma = cleaned.lastIndexOf(",");
  if (lastComma >= 0) {
    const intPart = cleaned.slice(0, lastComma).replace(/\./g, "");
    const decPart = cleaned.slice(lastComma + 1).replace(/\./g, "");
    return sign + (intPart || "0") + (decPart ? `.${decPart}` : "");
  }
  // Sem vírgula: pontos são milhar. "50.000" → 50000; "1.234.567" → 1234567.
  return sign + cleaned.replace(/\./g, "");
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
  const preview = new TextDecoder("utf-8").decode(new Uint8Array(buf).slice(0, 4096)).trimStart();
  // Exportações TASY em .xls frequentemente são HTML disfarçado. No navegador,
  // a leitura por ArrayBuffer pode cair no parser CSV e quebrar valores "326,06".
  const wb = /<table[\s>]/i.test(preview) || /^<(?:!doctype\s+html|html)\b/i.test(preview)
    ? XLSX.read(new TextDecoder("utf-8").decode(buf).trimStart(), { type: "string" })
    : XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { headers: [], rows: [] };
  // O TASY costuma exportar moeda BR em XLS/HTML. Sem restaurar o texto
  // formatado, SheetJS pode transformar "326,06" em 32606 e inflar a apuração.
  preserveFormattedBrazilianNumbers(sheet);
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: "", raw: true });
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

export type CompanyOption = { id: string; name: string; aliases?: string[] | null };

export type CompanyMappingConfig = {
  /** Universo de PJs candidatas (normalmente todas do hospital). */
  companies: CompanyOption[];
  /**
   * Chave do target que contém o nome bruto da PJ na planilha
   * (default: "company_hint"). Se o target não estiver mapeado, o passo
   * de vínculo de PJs é ignorado.
   */
  companyHintKey?: string;
};

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
  /** Se presente e o target de PJ estiver mapeado, adiciona um passo "Vincular PJs". */
  companyMappingConfig?: CompanyMappingConfig;
  onCancel: () => void;
  onConfirm: (
    drafts: Record<string, string>[],
    meta: {
      mapping: Record<string, string>;
      totals: { file: number; valid: number; excluded: number; dropped: number };
      droppedExamples: Array<{ row_index: number; missing: string[] }>;
      /** Mapping rawName (normalizado como aparece na planilha) → company.id (ou null = ignorar). */
      companyMapping?: Record<string, string | null>;
    },
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
  companyMappingConfig,
  onCancel,
  onConfirm,
}: MappingWizardProps) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [excludeConsultas, setExcludeConsultas] = useState(true);
  const [step, setStep] = useState<"columns" | "companies">("columns");
  const [companyMapping, setCompanyMapping] = useState<Record<string, string | null>>({});
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  const companyHintKey = companyMappingConfig?.companyHintKey ?? "company_hint";
  const companyHintCol = mapping[companyHintKey];
  const hasCompanyStep =
    !!companyMappingConfig && !!companyHintCol && companyHintCol !== NONE;

  // Detecta coluna de setor / centro de custo (mesma heurística da conciliação do lote)
  const sectorCol = useMemo(() => {
    return headers.find((k) => {
      const n = k.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
      return n.includes("setor") || n.includes("centro") || n.includes("custos");
    }) ?? null;
  }, [headers]);

  const availableSectors = useMemo(() => {
    if (!sectorCol) return [] as string[];
    const set = new Set<string>();
    for (const r of rows) {
      const v = String(r[sectorCol] ?? "").trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [rows, sectorCol]);

  // Linhas efetivas após o filtro de setor — aplicado antes do mapeamento e contagens.
  const filteredRows = useMemo(() => {
    if (!sectorCol || selectedSectors.length === 0) return rows;
    return rows.filter((r) => selectedSectors.includes(String(r[sectorCol] ?? "").trim()));
  }, [rows, sectorCol, selectedSectors]);

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
      setSelectedSectors([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, headers]);

  const preview = useMemo(() => filteredRows.slice(0, 3), [filteredRows]);

  const { valid, dropped, excluded, droppedExamples } = useMemo(() => {
    if (Object.keys(mapping).length === 0)
      return { valid: [] as Record<string, string>[], dropped: 0, excluded: 0, droppedExamples: [] as Array<{ row_index: number; missing: string[] }> };
    const descKey = targets.find((t) => /procedure_name|procedimento|descricao/i.test(t.key))?.key;
    const descCol = descKey ? mapping[descKey] : undefined;
    let excludedCount = 0;
    const built: Record<string, string>[] = [];
    let droppedCount = 0;
    const examples: Array<{ row_index: number; missing: string[] }> = [];
    const requiredTargets = targets.filter((t) => t.required);
    for (let i = 0; i < filteredRows.length; i++) {
      const r = filteredRows[i];
      if (showExcludeConsultas && excludeConsultas && descCol && descCol !== NONE) {
        const desc = String(r[descCol] ?? "");
        if (EXCLUDE_REGEX.test(desc)) {
          excludedCount++;
          continue;
        }
      }
      const d = buildRow(r, mapping, targets);
      const missing = requiredTargets.filter((t) => !d[t.key]).map((t) => t.label);
      if (missing.length === 0) built.push(d);
      else {
        droppedCount++;
        if (examples.length < 10) examples.push({ row_index: i + 2, missing });
      }
    }
    return { valid: built, dropped: droppedCount, excluded: excludedCount, droppedExamples: examples };
  }, [filteredRows, mapping, excludeConsultas, targets, showExcludeConsultas]);

  const missingRequired = targets.filter(
    (t) => t.required && (!mapping[t.key] || mapping[t.key] === NONE),
  );

  /** Nomes brutos únicos de PJ presentes nas linhas válidas (para o passo 2). */
  const rawCompanyNames = useMemo(() => {
    if (!hasCompanyStep) return [] as string[];
    const set = new Set<string>();
    for (const d of valid) {
      const raw = (d[companyHintKey] ?? "").trim();
      if (raw) set.add(raw);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [valid, hasCompanyStep, companyHintKey]);

  const aliasMap: AliasMap = useMemo(() => {
    const m: AliasMap = {};
    if (!companyMappingConfig) return m;
    for (const c of companyMappingConfig.companies) {
      m[c.name] = { aliases: c.aliases ?? [] };
    }
    return m;
  }, [companyMappingConfig]);

  const candidateNames = useMemo(
    () => (companyMappingConfig?.companies ?? []).map((c) => c.name),
    [companyMappingConfig],
  );
  const idByName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of companyMappingConfig?.companies ?? []) m[c.name] = c.id;
    return m;
  }, [companyMappingConfig]);

  // Índice pré-calculado: evita iterar candidateNames a cada raw name.
  // Reconstruído apenas quando a lista de candidatos ou aliases muda.
  const companyIndex = useMemo(
    () => buildCompanyIndex(candidateNames, aliasMap),
    [candidateNames, aliasMap],
  );

  // Sementeia auto-match ao entrar no passo de PJs (ou quando lista muda).
  useEffect(() => {
    if (step !== "companies" || !hasCompanyStep) return;
    setCompanyMapping((prev) => {
      const next: Record<string, string | null> = { ...prev };
      for (const raw of rawCompanyNames) {
        if (next[raw] !== undefined) continue;
        const hit = findCompanyMatch(raw, candidateNames, aliasMap, companyIndex);
        // medium = precisa confirmação → começa em null
        next[raw] = hit.level === "exact" || hit.level === "high"
          ? (hit.company ? idByName[hit.company] ?? null : null)
          : null;
      }
      return next;
    });
  }, [step, hasCompanyStep, rawCompanyNames, candidateNames, aliasMap, idByName, companyIndex]);

  const mappingRows: MappingRow[] = useMemo(() => {
    return rawCompanyNames.map((raw) => {
      const hit = findCompanyMatch(raw, candidateNames, aliasMap, companyIndex);
      return { key: raw, rawLabel: raw, level: hit.level };
    });
  }, [rawCompanyNames, candidateNames, aliasMap, companyIndex]);


  const companyOptions = useMemo(
    () => (companyMappingConfig?.companies ?? []).map((c) => ({ id: c.id, label: c.name })),
    [companyMappingConfig],
  );

  const finalize = () => {
    onConfirm(valid, {
      mapping,
      totals: { file: rows.length, valid: valid.length, excluded, dropped },
      droppedExamples,
      companyMapping: hasCompanyStep ? companyMapping : undefined,
    });
  };

  const showCompaniesStep = step === "companies" && hasCompanyStep;
  const confirmedCompanies = rawCompanyNames.filter((r) => companyMapping[r]).length;
  const ignoredCompanies = rawCompanyNames.length - confirmedCompanies;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="p-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheetIcon className="h-4 w-4" />
            {showCompaniesStep ? "Vincular PJs da planilha" : dialogTitle}
          </DialogTitle>
          <DialogDescription className="text-xs">
            <span className="font-medium text-foreground">{fileName}</span> · {rows.length} linhas · {headers.length} colunas
            {hasCompanyStep && (
              <span className="ml-2 text-muted-foreground">
                · Passo <strong>{showCompaniesStep ? "2" : "1"}</strong> de 2
              </span>
            )}
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
          ) : showCompaniesStep ? (
            <>
              <div className="text-xs text-muted-foreground">
                Encontramos <strong className="text-foreground">{rawCompanyNames.length}</strong> PJ(s) distinta(s) na
                coluna mapeada. Vincule cada uma à empresa cadastrada correspondente — apelidos confirmados serão
                reaproveitados nas próximas importações (mesmo aprendizado usado no cruzamento do lote).
              </div>
              {rawCompanyNames.length === 0 ? (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/40 p-3 text-xs">
                  <AlertCircleIcon className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                  <div>Nenhum nome de PJ encontrado nas linhas válidas. Você pode confirmar sem vincular.</div>
                </div>
              ) : (
                <CompanyMappingList
                  rows={mappingRows}
                  options={companyOptions}
                  value={companyMapping}
                  onChange={(key, id) => setCompanyMapping((m) => ({ ...m, [key]: id }))}
                  onConfirm={(key) => {
                    // Aceita a sugestão medium: resolve o nome via findCompanyMatch e grava o id.
                    const hit = findCompanyMatch(key, candidateNames, aliasMap);
                    if (hit.company) {
                      setCompanyMapping((m) => ({ ...m, [key]: idByName[hit.company!] ?? null }));
                    }
                  }}
                />
              )}
            </>
          ) : (
            <>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Mapeamento de colunas
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-2.5">
                  {targets.map((t) => {
                    const col = mapping[t.key];
                    const sampleValues = col && col !== NONE
                      ? filteredRows
                          .map((r) => String(r[col] ?? "").trim())
                          .filter(Boolean)
                          .slice(0, 3)
                      : [];
                    return (
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
                        {sampleValues.length > 0 && (
                          <p
                            className="mt-1 text-[10px] text-muted-foreground truncate"
                            title={`Amostra: ${sampleValues.join(" · ")}`}
                          >
                            <span className="opacity-70">ex.:</span> {sampleValues.join(" · ")}
                          </p>
                        )}
                      </div>
                    );
                  })}
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

              {sectorCol && availableSectors.length > 0 && (
                <div className="rounded-md border border-border bg-muted/20 px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-foreground">Filtrar por setor / centro de custo</p>
                      <p className="text-[11px] text-muted-foreground">
                        Coluna detectada: <span className="font-mono">{sectorCol}</span>. Selecione apenas os setores pertinentes — deixe todos desmarcados para incluir a base completa.
                      </p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setSelectedSectors(availableSectors)}
                      >
                        Todos
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        onClick={() => setSelectedSectors([])}
                      >
                        Limpar
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-40 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {availableSectors.map((sector) => {
                      const checked = selectedSectors.includes(sector);
                      const count = rows.filter((r) => String(r[sectorCol] ?? "").trim() === sector).length;
                      return (
                        <label
                          key={sector}
                          className={`flex items-center gap-2 rounded px-2 py-1 cursor-pointer text-xs ${
                            checked ? "bg-primary/10" : "hover:bg-muted/50"
                          }`}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() =>
                              setSelectedSectors((prev) =>
                                checked ? prev.filter((s) => s !== sector) : [...prev, sector],
                              )
                            }
                          />
                          <span className="flex-1 truncate">{sector}</span>
                          <span className="text-[10px] text-muted-foreground">{count}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    <strong>{selectedSectors.length}</strong> setor(es) selecionado(s) ·{" "}
                    <strong className="text-foreground">{filteredRows.length}</strong> de {rows.length} linha(s) considerada(s)
                  </p>
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
                <Badge variant="outline" className="text-[10px]">
                  {rows.length} no arquivo
                </Badge>
                {sectorCol && selectedSectors.length > 0 && (
                  <>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline" className="text-[10px]">
                      {filteredRows.length} após filtro de setor
                    </Badge>
                  </>
                )}
                <span className="text-muted-foreground">=</span>
                <Badge variant="default" className="text-[10px]">{valid.length} válidas</Badge>
                <span className="text-muted-foreground">+</span>
                <Badge variant="outline" className="text-[10px]">
                  {excluded} excluídas{showExcludeConsultas ? " (visita/parecer/consulta)" : ""}
                </Badge>
                <span className="text-muted-foreground">+</span>
                <Badge variant="outline" className={`text-[10px] ${dropped > 0 ? "border-amber-500 text-amber-700" : ""}`}>
                  {dropped} descartadas (faltando dados)
                </Badge>
                {missingRequired.length > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    Faltando: {missingRequired.map((t) => t.label).join(", ")}
                  </Badge>
                )}
              </div>

              {droppedExamples.length > 0 && (
                <details className="rounded-md border border-amber-200 bg-amber-50/40 px-3 py-2 text-[11px]">
                  <summary className="cursor-pointer font-medium text-amber-800">
                    Ver exemplos de linhas descartadas ({droppedExamples.length} de {dropped})
                  </summary>
                  <ul className="mt-2 space-y-0.5 text-amber-900">
                    {droppedExamples.map((ex) => (
                      <li key={ex.row_index}>
                        Linha {ex.row_index}: falta <strong>{ex.missing.join(", ")}</strong>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-amber-700/80">
                    Se muitas linhas estão caindo aqui, revise o mapeamento — provavelmente uma coluna obrigatória apontou para o campo errado.
                  </p>
                </details>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 p-4 border-t bg-muted/10 sm:justify-between">
          <div className="flex items-center gap-2">
            {showCompaniesStep ? (
              <Button variant="ghost" size="sm" onClick={() => setStep("columns")}>
                <ArrowLeftIcon className="h-3.5 w-3.5 mr-1" /> Voltar
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
            )}
            {showCompaniesStep && (
              <span className="text-[11px] text-muted-foreground">
                <span className="text-success font-semibold">{confirmedCompanies}</span> vinculadas ·{" "}
                <span className="text-muted-foreground">{ignoredCompanies}</span> ignoradas
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showCompaniesStep && (
              <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
            )}
            {!showCompaniesStep && hasCompanyStep ? (
              <Button
                size="sm"
                onClick={() => setStep("companies")}
                disabled={valid.length === 0 || missingRequired.length > 0}
              >
                Continuar · Vincular PJs
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={finalize}
                disabled={valid.length === 0 || missingRequired.length > 0}
              >
                Confirmar e adicionar {valid.length} de {rows.length} linha(s)
              </Button>
            )}
          </div>
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
  { key: "tasy_valor_unit", label: "Valor total da linha (valor × qtd, base 100%)", required: true, aliases: ["valortotal", "vlrtotal", "valorlinha", "valor", "valorunit", "valorunitario", "vlrunit", "vlrunitario", "unitario"] },
  { key: "tasy_procedimento", label: "Descrição do procedimento", required: false, aliases: ["procedimento", "descricao", "descrprocedi", "nomeprocedimento", "matmed"] },
  { key: "tasy_paciente", label: "Nome do paciente", required: false, aliases: ["paciente", "nomepaciente", "nmpaciente"] },
  { key: "tasy_data", label: "Data do procedimento", required: false, aliases: ["datacir", "dataprocedi", "datacirurgia", "data"] },
  { key: "tasy_convenio", label: "Convênio", required: false, aliases: ["convenio", "plano", "operadora"] },
  { key: "tasy_medico", label: "Médico executante", required: false, aliases: ["medico", "executante", "executor", "nomemedico"] },
  { key: "tasy_funcao", label: "Função", required: false, aliases: ["funcao", "papel"] },
  { key: "tasy_empresa", label: "Empresa / PJ (Terceiro)", required: false, aliases: ["empresa", "pj", "terceiro", "prestador", "razaosocial", "cnpj", "fornecedor"] },
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

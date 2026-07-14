import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/PageHeader";
import { CostCenterCombobox } from "@/components/CostCenterCombobox";
import { MonthMultiSelect } from "@/components/MonthMultiSelect";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useHospital } from "@/contexts/HospitalContext";
import { toast } from "@/hooks/use-toast";
import { recordObservation } from "@/lib/observations";
import { formatCurrency, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, PAYMENT_TRACK_LABELS, PAYMENT_TRACK_DESCRIPTIONS, type PaymentType, type PaymentKind, type PaymentTrack } from "@/lib/status";
import { PAYMENT_ANALYSIS_MODE_LABELS, PAYMENT_ANALYSIS_MODE_DESCRIPTIONS, type PaymentAnalysisMode } from "@/lib/status";
import { FileSpreadsheet, Loader2, Sparkles, Upload, X, Building2, CheckCircle2, AlertCircle, AlertTriangle, Pencil, Plus, RefreshCw, Calculator, History, Focus, Target, Bot } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { CompanyRiskProfileList } from "@/components/payment-detail/CompanyRiskProfile";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";
import { usePaymentTypeCodeSync } from "@/hooks/usePaymentTypeCodeSync";
import { fetchCompanyRiskProfiles } from "@/lib/companyRiskProfile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

import { RULE_SECTOR_LABELS, type RuleSector } from "@/lib/status";
import { normalizeNumericValue } from "@/lib/utils";
import { resolvePaymentAmounts } from "@/lib/resolvePaymentAmounts";
import { loadSectorAliases } from "@/hooks/useSectorAliases";
import { learnCompanyAlias, shouldLearnAlias } from "@/lib/learnCompanyAlias";
import { loadDraft, saveDraft, clearDraft, fileKey, isDraftMeaningful, type FileDecision } from "@/lib/newPaymentDraft";
import { detectSectorColumn, type SectorColumnDetection } from "@/lib/detectSectorColumn";
import { applySectorStems } from "@/lib/sectorStems";
import { sha256Hex, inferBucketRole } from "@/lib/fileHash";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";

import {
  loadDoctorRegistry,
  loadConvenioRegistry,
  loadSectorRegistry,
  resolveDoctor,
  resolveConvenio,
  resolveSector,
  learnAliasesFromResolvedRows,
  type DoctorRegistry,
  type ConvenioRegistry,
  type SectorRegistry,
} from "@/lib/registryLookup";
import { RegistryResolutionPanel, type UnresolvedGroup } from "@/components/RegistryResolutionPanel";
import {
  extractCompanyFromFilename,
  matchCompany,
  MATCH_AUTO_THRESHOLD,
  MATCH_REVIEW_THRESHOLD,
  MATCH_CONFIRM_MIN,
  excelDateToISOWithFlag as excelDateToISOWithFlagLib,
} from "@/lib/parsePaymentFile";
import {
  applyManualMappingShim,
  inspectColumnMapping,
  summarizeMissing,
  FIELD_BY_KEY,
  type ManualMapping,
  type FieldMappingHit,
} from "@/lib/columnMapping";
import { useSheetColumnTemplates } from "@/hooks/useSheetColumnTemplates";
import ColumnMappingDialog from "@/components/payment/ColumnMappingDialog";
import { confirmDialog } from "@/lib/confirm";
import { detectSuspiciousRows } from "@/lib/detectSuspiciousRows";
import { SuspiciousRowsReview, type SuspiciousDecision } from "@/components/payment-wizard/SuspiciousRowsReview";
import { ParecerReportWizardCard, type ParecerWizardPayload } from "@/components/payment-wizard/ParecerReportWizardCard";
import { MixedParecerSetupCard, useAmbiguousTussCount, type MixedParecerSetup } from "@/components/payment-wizard/MixedParecerSetupCard";
import { SpecialtyResolutionModal } from "@/components/payment-wizard/SpecialtyResolutionModal";

import { ZeevAssistant, type ZeevInsight } from "@/components/copilot/ZeevAssistant";
import type { StagingContext, StagingDecision } from "@/components/copilot/ZeevStagingChat";
import { DateInput } from "@/components/ui/date-input";
import { CurrencyInput } from "@/components/ui/currency-input";

interface ParsedRow {
  doctor_name: string;
  doctor_document: string;
  doctor_email: string;
  description: string;
  gross_amount: number;
  valor_invalido?: boolean;
  // novos
  company_name: string | null;
  company_id: string | null;
  attendance_number: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  access_route: string | null;
  doctor_role: string | null;
  agreement_text: string | null;
  specialty: string | null;
  procedure_amount: number | null;
  quantity: number | null;
  procedure_date: string | null;
  /** true se a hora foi extraída da base; usado pelo motor para aplicar (ou não) adicional noturno. */
  procedure_date_has_time: boolean;
  patient_name: string | null;
  sector: string | null;
  attendance_character: string | null;
  raw_data: Record<string, unknown>;
  source_file?: string;
  source_row_number?: number;
  source_bucket_index?: number;
  source_row_index?: number;
  tipo_linha_manual?: LineType | null;
  tipo_linha: LineType;
  line_issues: LineIssue[];
  /** Override per-row de payment_type_id quando a base mistura subtipos
   * (ex.: planilha de Parecer com algumas linhas de Visita). Preenchido pelo
   * parser via `subtype_split_hint` do tipo escolhido na criação da base. */
  payment_type_id_override?: string | null;
  /** true quando a coluna de repasse (gross_amount) foi mapeada/canônica —
   *  inclusive com valor 0 (ex.: Retorno não pago). Permite distinguir
   *  "0 legítimo" de "valor ausente" na validação. */
  gross_explicit?: boolean;
  /** Origem da PJ resolvida para esta linha:
   *  - 'arquivo'  → veio do nome do arquivo (comportamento antigo)
   *  - 'planilha' → veio de coluna explícita de PJ na linha
   *  - 'none'     → não foi possível resolver (item isolado) */
  company_source?: "arquivo" | "planilha" | "none";
}


// === Classificação de tipo_linha (pré-validação) ===
export type LineType =
  | "procedimento"
  | "visita"
  | "parecer"
  | "pacote"
  | "complemento_bonus"
  | "glosa_desconto"
  | "reprocessamento"
  | "outro";

export interface LineIssue {
  severity: "critico" | "alerta";
  field: string;
  message: string;
}

const LINE_TYPE_LABELS: Record<LineType, string> = {
  procedimento: "Procedimento",
  visita: "Visita",
  parecer: "Parecer",
  pacote: "Pacote",
  complemento_bonus: "Complemento/Bônus",
  glosa_desconto: "Glosa/Desconto",
  reprocessamento: "Reprocessamento/Pendência",
  outro: "Outro / Não identificado",
};

// Classificação canônica: delegada ao parser único (word-boundary + exige
// ausência de TUSS + ignora procedure_name para termos de complemento/bônus).
// Evita falso-positivo de nomes TUSS como "... Adicional" caírem como bônus.
import { classifyLine as canonicalClassifyLine, preserveFormattedBrazilianNumbers, readWorkbookPreservingText } from "@/lib/parsePaymentFile";

const classifyLine = (
  r: Omit<ParsedRow, "tipo_linha" | "line_issues">,
  paymentKind?: string | null,
): LineType => canonicalClassifyLine(r as never, paymentKind ?? null) as LineType;


const validateLine = (
  r: Omit<ParsedRow, "line_issues">,
  opts?: { modoConfeccao?: boolean },
): LineIssue[] => {
  const issues: LineIssue[] = [];
  const modoConfeccao = !!opts?.modoConfeccao;
  const hasDoctor = !!r.doctor_name?.trim();
  // 0 explícito (coluna de repasse mapeada com valor 0 — ex.: Retorno não pago)
  // é legítimo: não bloqueia. Só consideramos "sem valor" quando não há repasse
  // explícito e a coluna estava vazia/ausente.
  const hasValue = Math.abs(r.gross_amount ?? 0) > 0 || !!r.gross_explicit;
  const hasAtt = !!r.attendance_number?.trim() || !!r.patient_name?.trim();
  const hasCode = !!r.procedure_code?.trim();
  const hasDesc = !!(r.description?.trim() || r.procedure_name?.trim());

  // No modo confecção o valor pago não é input: o motor calcula a partir das regras.
  // Pacotes têm secundários com valor 0 propositalmente; bloqueio por "Valor obrigatório"
  // não faz sentido aqui. Mantemos só validação de valor numérico inválido (texto não-parseável).
  const requireValue = (msg: string) => {
    if (modoConfeccao) return;
    if (!hasValue) issues.push({ severity: "critico", field: "gross_amount", message: msg });
  };

  if (r.valor_invalido && r.tipo_linha !== "glosa_desconto") {
    // Em glosa/desconto valores negativos são esperados (estorno/abatimento),
    // então não bloqueamos. NaN ainda cai em "Valor obrigatório" abaixo (value=0).
    issues.push({ severity: "critico", field: "gross_amount", message: "Valor numérico inválido ou negativo detectado na linha" });
  }

  switch (r.tipo_linha) {
    case "procedimento":
      if (!hasDoctor) issues.push({ severity: "critico", field: "doctor_name", message: "Médico obrigatório" });
      requireValue("Valor obrigatório");
      if (!hasCode && !hasDesc) issues.push({ severity: "critico", field: "procedure_code", message: "Código TUSS ou descrição obrigatório" });
      if (!hasAtt) issues.push({ severity: "alerta", field: "attendance_number", message: "Atendimento/paciente recomendado" });
      break;
    case "visita":
    case "parecer":
      if (!hasDoctor) issues.push({ severity: "critico", field: "doctor_name", message: "Médico obrigatório" });
      // Valor zerado é permitido em parecer/visita (atendimento não pago precisa
      // ficar zerado para justificar). Vira alerta visível, não bloqueante.
      if (!modoConfeccao && !hasValue) {
        issues.push({ severity: "alerta", field: "gross_amount", message: "Valor zerado — confirme se é parecer/visita não pago (justifique no campo de observação)" });
      }
      break;
    case "pacote":
      requireValue("Valor total obrigatório");
      if (!hasAtt) issues.push({ severity: "critico", field: "attendance_number", message: "Atendimento/paciente obrigatório no pacote" });
      if (!hasCode) issues.push({ severity: "alerta", field: "procedure_code", message: "Código principal recomendado" });
      break;
    case "complemento_bonus":
      if (!hasDoctor) issues.push({ severity: "critico", field: "doctor_name", message: "Médico obrigatório" });
      requireValue("Valor obrigatório");
      if (!hasAtt) issues.push({ severity: "alerta", field: "attendance_number", message: "Atendimento ausente — recomendado" });
      break;
    case "glosa_desconto":
      requireValue("Valor obrigatório");
      if (!hasDesc) issues.push({ severity: "critico", field: "description", message: "Motivo/descrição obrigatório" });
      break;
    case "reprocessamento":
      requireValue("Valor obrigatório");
      if (!hasDoctor) issues.push({ severity: "alerta", field: "doctor_name", message: "Médico recomendado" });
      break;
    case "outro":
      issues.push({ severity: "alerta", field: "tipo_linha", message: "Tipo de lançamento não identificado — classificar manualmente" });
      break;
  }
  return issues;
};


interface ColumnOverrides {
  doctor?: string;
  gross?: string;
  repasse?: string;
  /** Override manual da coluna que carrega o setor de cada linha. */
  sectorColumn?: string;
}

interface FileBucket {
  file: File;
  rows: ParsedRow[];
  rawCompanyName: string;
  matchedCompany: { id: string; name: string } | null;
  matchScore: number;
  /** true quando o usuário trocou a empresa manualmente (não foi o match automático). */
  manualOverride?: boolean;
  /** Mapeamento de setor identificado na planilha para o setor do sistema */
  sectorMapping?: string | null;
  /** true quando NENHUMA linha da planilha trouxe coluna de setor preenchida — exige mapeamento manual antes do envio. */
  sectorMissing?: boolean;
  /** Se verdadeiro, o valor do convênio nesta planilha já é o total (Unitário * Qtd). */
  convenioValueTotalized?: boolean;
  /** Override manual de colunas quando o auto-detect falha em planilhas atípicas. */
  columnOverrides?: ColumnOverrides;
  /** Matriz crua da planilha (linhas x colunas), para permitir trocar a linha de cabeçalho. */
  rawMatrix?: unknown[][];
  /** Índice (0-based) da linha de cabeçalho atualmente usada. */
  headerRowIndex?: number;
  /** Resultado da detecção da coluna "setor" (candidatos sugeridos para o usuário confirmar). */
  sectorColumnDetection?: SectorColumnDetection;
  /** Coluna efetivamente usada como setor (auto OU escolhida pelo usuário). */
  sectorColumnUsed?: string | null;
  /** Headers crus detectados na linha de cabeçalho. */
  detectedHeaders?: string[];
  /** Linha de exemplo (primeira de dados) — alimenta preview no diálogo de mapeamento. */
  sampleRow?: Record<string, unknown> | null;
  /** Resultado da inspeção campo→header (heurística + overrides). */
  mappingHits?: FieldMappingHit[];
  /** Override de mapeamento aplicado pelo analista ou por template salvo. */
  columnMapping?: ManualMapping;
  /** Template aplicado automaticamente (quando assinatura bateu). */
  appliedTemplate?: { id: string; name: string } | null;
}

type RetroTvrResult = {
  key?: string;
  atendimento?: string;
  tuss?: string;
  procedimento?: string;
  paciente?: string;
  data?: string;
  convenio?: string;
  medico?: string;
  funcao?: string;
  funcoes_pagas?: string;
  qtd_tasy?: number;
  qtd_por_func?: number;
  valor_unit_tasy?: number;
  valor_total_tasy?: number;
  dif_valor?: number;
  matched_payment_item_id?: string;
  status?: string;
};

const isRetroComplementar = (r: RetroTvrResult) =>
  r.status === "nao_pago" ||
  ((r.status === "div_valor" || r.status === "div_qtd_valor") && Number(r.dif_valor ?? 0) > 0.5);

const retroComplementBase = (r: RetroTvrResult) => {
  if (r.status === "nao_pago") return Math.max(0, Number(r.valor_total_tasy ?? 0));
  return Math.max(0, Number(r.dif_valor ?? 0));
};

const retroComplementQuantity = (r: RetroTvrResult) => {
  if (r.status === "nao_pago") return Math.max(1, Number(r.qtd_tasy ?? 1));
  const missingQty = Number(r.qtd_tasy ?? 0) - Number(r.qtd_por_func ?? 0);
  return missingQty > 0.5 ? missingQty : 1;
};

const monthsBetween = (start?: string | null, end?: string | null) => {
  if (!start || !end) return [];
  const out: string[] = [];
  const cur = new Date(`${start.slice(0, 7)}-01T00:00:00`);
  const last = new Date(`${end.slice(0, 7)}-01T00:00:00`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) return [];
  while (cur <= last && out.length < 24) {
    out.push(cur.toISOString().slice(0, 7));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
};

const buildRetroWorkbookFile = (rows: Record<string, unknown>[], filename: string) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Confecção");
  const data = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new File([data], filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
};

interface CompanyRow { id: string; name: string; aliases: string[] }

/** Erro detalhado de parsing — carrega título, motivos e instruções de correção. */
class ParseFileError extends Error {
  title: string;
  reasons: string[];
  howToFix: string[];
  constructor(title: string, reasons: string[], howToFix: string[]) {
    super(title);
    this.name = "ParseFileError";
    this.title = title;
    this.reasons = reasons;
    this.howToFix = howToFix;
  }
}


const norm = (s: string) => (s ?? "").toString().toLowerCase().trim().replace(/[\s_\-./]+/g, "");

/**
 * Match por SCORE (espelha src/lib/parsePaymentFile.ts):
 *  - igualdade normalizada: 100; startsWith: 60; includes: 30
 *  - bônus por posição da chave (chaves antes valem mais → canônicas)
 *  - `excludes` descarta headers que contenham termos proibidos
 *    (ex.: ao buscar "médico", excluir "Medico Solic." — solicitante, não prestador)
 *
 * Por que: o `pick` antigo retornava o PRIMEIRO header que contivesse a
 * palavra-chave. Em planilhas de parecer, a coluna "Repasse" contém o NOME
 * do médico, não um número → todas as linhas eram marcadas como
 * "valor numérico inválido". Score + excludes resolvem.
 */
const pick = (
  row: Record<string, unknown>,
  keys: string[],
  excludes: string[] = [],
): unknown => {
  const headers = Object.keys(row);
  const nExcludes = excludes.map(norm).filter(Boolean);
  let bestKey: string | null = null;
  let bestScore = 0;
  headers.forEach((rk) => {
    const nrk = norm(rk);
    if (!nrk) return;
    if (nExcludes.some((ex) => nrk.includes(ex))) return;
    let score = 0;
    keys.forEach((k, idx) => {
      const nk = norm(k);
      if (!nk) return;
      let s = 0;
      if (nrk === nk) s = 100;
      else if (nrk.startsWith(nk)) s = 60;
      else if (nrk.includes(nk)) s = 30;
      if (s === 0) return;
      s += Math.max(0, 10 - idx);
      if (s > score) score = s;
    });
    if (score > bestScore) { bestScore = score; bestKey = rk; }
  });
  return bestKey != null ? row[bestKey] : undefined;
};


const toStr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

const EXPLICIT_ROW_COMPANY_KEYS = [
  "empresa", "empresa pj", "empresa (pj)", "pj", "fornecedor", "terceiro", "terceiro prestador",
  "razao social", "razão social", "nome empresa", "nome da empresa",
];
const LEGACY_ROW_COMPANY_KEYS = ["hospital", "unidade", "unidade de atendimento"];

const readRowCompanyName = (
  row: Record<string, unknown>,
  manualMapping?: ManualMapping,
  includeLegacy = true,
): string | null => {
  const mappedHeader = manualMapping?.company_name;
  if (mappedHeader && mappedHeader in row) return toStr(row[mappedHeader]);
  const explicit = toStr(pick(row, EXPLICIT_ROW_COMPANY_KEYS));
  if (explicit) return explicit;
  return includeLegacy ? toStr(pick(row, LEGACY_ROW_COMPANY_KEYS)) : null;
};

const hasMultipleDistinctCompanyValues = (
  json: Record<string, unknown>[],
  manualMapping?: ManualMapping,
): boolean => {
  const distinct = new Set<string>();
  for (const row of json) {
    const v = readRowCompanyName(row, manualMapping, false);
    if (!v) continue;
    distinct.add(v.trim().toLowerCase());
    if (distinct.size > 1) return true;
  }
  return false;
};

const shouldTrustFilenameCompany = (
  score: number,
  company: CompanyRow | null,
  json: Record<string, unknown>[],
  manualMapping?: ManualMapping,
): boolean => score >= MATCH_AUTO_THRESHOLD && !!company && !hasMultipleDistinctCompanyValues(json, manualMapping);

/**
 * Converte data crua da base hospitalar para ISO. Retorna também
 * `hasTime` indicando se a HORA do atendimento veio explícita na origem
 * (necessário para o motor decidir se aplica adicional noturno — sem
 * hora real, noturno NÃO é aplicado).
 */
// Delegado para a versão canônica em src/lib/parsePaymentFile.ts para
// garantir consistência (ancoragem em meio-dia UTC para datas sem hora,
// evitando deslocamento de fuso ao exibir a data salva).
const excelDateToISOWithFlag = excelDateToISOWithFlagLib;

const excelDateToISO = (v: unknown): string | null => excelDateToISOWithFlag(v).iso;

// Matching de empresa centralizado em src/lib/parsePaymentFile.ts (ver imports no topo).

// Palavras-âncora que indicam linha de cabeçalho de dados de pagamento.
// Usadas para pular metadados (empresa, CNPJ, vigência, totalizadores) que
// algumas planilhas empilham nas primeiras linhas antes do cabeçalho real.
const HEADER_ANCHORS = [
  "medico","médico","prestador","parecerista","executante","executor",
  "paciente","atendimento","procedimento","proced","tuss",
  "data","dt","convenio","convênio","especialidade","setor","grupo",
  "valor","repasse","bruto","pagar","quantidade","qtd","quant","funcao","função",
  "registro","produto",
];

const detectHeaderRow = (rows: unknown[][]): number => {
  const MAX_SCAN = Math.min(rows.length, 30);
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < MAX_SCAN; i++) {
    const r = rows[i] || [];
    let score = 0;
    for (const cell of r) {
      if (typeof cell !== "string") continue;
      const n = norm(cell);
      if (!n || n.length > 40) continue;
      if (HEADER_ANCHORS.some((a) => n === norm(a) || n.includes(norm(a)))) score++;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestScore >= 3 ? bestIdx : 0;
};

const matrixToJson = (matrix: unknown[][], headerIdx: number): Record<string, unknown>[] => {
  const headerRow = (matrix[headerIdx] || []).map((h, i) => {
    const s = (h ?? "").toString().trim();
    return s.length ? s : `__col_${i}`;
  });
  const out: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] || [];
    if (row.every((c) => c == null || c === "")) continue;
    const obj: Record<string, unknown> = {};
    headerRow.forEach((key, ci) => { obj[key] = row[ci] ?? ""; });
    out.push(obj);
  }
  return out;
};


const NewPayment = () => {
  const { user, roles, isSenior } = useAuth();
  const canImportHistorico =
    roles.includes("admin") || roles.includes("diretor") || (roles.includes("analista") && isSenior);

  const { hospital } = useHospital();
  const navigate = useNavigate();
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [competenceMonths, setCompetenceMonths] = useState<string[]>([]); // ["YYYY-MM", ...]
  const [paymentDueDate, setPaymentDueDate] = useState(""); // YYYY-MM-DD
  const [paymentType, setPaymentType] = useState<PaymentType | "">("");
  const [paymentKind, setPaymentKind] = useState<PaymentKind | "">("");
  const [paymentTrack, setPaymentTrack] = useState<PaymentTrack | "">("");
  const [costCenterCode, setCostCenterCode] = useState<string | null>(null);
  const [pSectors, setPSectors] = useState<string[]>([]);
  const [pSpecialties, setPSpecialties] = useState<string[]>([]);
  const [buckets, setBuckets] = useState<FileBucket[]>([]);
  // Dialog de cadastro rápido de PJ ancorado no card do arquivo.
  const [newCompanyDialog, setNewCompanyDialog] = useState<
    | { idx: number; name: string; document: string; busy: boolean }
    | null
  >(null);
  const [bucketFilter, setBucketFilter] = useState("");
  // Debounce: evita refiltrar a lista a cada tecla em lotes grandes (300ms).
  const [debouncedBucketFilter, setDebouncedBucketFilter] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBucketFilter(bucketFilter), 300);
    return () => clearTimeout(t);
  }, [bucketFilter]);
  const [mappingDialog, setMappingDialog] = useState<{ open: boolean; bucketIdx: number | null }>({ open: false, bucketIdx: null });
  const { findMatching: findMatchingTemplate, markUsed: markTemplateUsed } = useSheetColumnTemplates(hospital?.id ?? null);
  const findMatchingTemplateRef = useRef(findMatchingTemplate);
  const markTemplateUsedRef = useRef(markTemplateUsed);
  useEffect(() => { findMatchingTemplateRef.current = findMatchingTemplate; }, [findMatchingTemplate]);
  useEffect(() => { markTemplateUsedRef.current = markTemplateUsed; }, [markTemplateUsed]);
  const [parseErrors, setParseErrors] = useState<Array<{ fileName: string; title: string; reasons: string[]; howToFix: string[] }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [includeAiOnSubmit, setIncludeAiOnSubmit] = useState(false);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const companiesRef = useRef<CompanyRow[]>([]);
  const companiesLoadPromiseRef = useRef<Promise<CompanyRow[]> | null>(null);
  const registriesLoadPromiseRef = useRef<Promise<void> | null>(null);
  const [searchParams] = useSearchParams();
  // Resolve o modo na seguinte ordem: query param → sessionStorage (escolhido
  // no modal antes de navegar) → padrão. Garante que se o param se perder no
  // caminho (refresh, redirect, navegação interna), a escolha do analista
  // ainda prevalece. Limpa sessionStorage após consumir.
  const initialMode: PaymentAnalysisMode = (() => {
    const fromUrl = searchParams.get("modo");
    if (fromUrl === "confeccao") return "confeccao";
    if (fromUrl === "analise") return "padrao";
    try {
      const fromStorage = sessionStorage.getItem("newPaymentMode");
      if (fromStorage === "confeccao") return "confeccao";
    } catch { /* ignore */ }
    return "padrao";
  })();
  const modoConfeccao = initialMode === "confeccao";
  const [analysisMode, setAnalysisMode] = useState<PaymentAnalysisMode>(initialMode);
  // Tipo de pagamento escolhido no modal pré-wizard (Parecer/Visita/Cirurgia/etc.).
  // Persistido em payments.payment_type_id no insert e propagado para payment_items.
  const initialPaymentModelId: string | null = (() => {
    const fromUrl = searchParams.get("tipo");
    if (fromUrl) return fromUrl;
    try {
      const fromStorage = sessionStorage.getItem("newPaymentTypeId");
      if (fromStorage) return fromStorage;
    } catch { /* ignore */ }
    return null;
  })();
  const [paymentModelId, setPaymentModelId] = useState<string | null>(initialPaymentModelId);
  // Metadados do tipo escolhido — usados pelo parser para injetar TUSS padrão,
  // função padrão e marcar quando a planilha não precisa trazer TUSS.
  type SubtypePattern = { match: string; target_item_type_id: string };
  type SubtypeSplitHint = { column: string; patterns: SubtypePattern[] } | null;
  type PaymentTypeMeta = {
    id: string;
    code: string;
    label: string;
    tuss_default: string | null;
    requires_tuss_in_sheet: boolean;
    default_function: string | null;
    default_value_column_hint: string | null;
    expected_headers: string[];
    allow_mixed_subtypes: boolean;
    subtype_split_hint: SubtypeSplitHint;
    /** TUSS extras aceitos como "ainda é Consulta" (vem de item_types.tuss_codes_extra). */
    consulta_tuss_extras: string[];
    /** item_types.id de "Procedimento" — destino quando lote é Consulta e o
     * TUSS da planilha não bate com consulta. */
    dynamic_fallback_item_type_id: string | null;
    /** ID canônico em item_types. `id` acima continua sendo o ID legado em payment_types para o lote. */
    item_type_id: string | null;
  };

  const [paymentModelMeta, setPaymentModelMeta] = useState<PaymentTypeMeta | null>(null);
  const paymentTypeMetaRef = useRef<PaymentTypeMeta | null>(null);
  useEffect(() => { paymentTypeMetaRef.current = paymentModelMeta; }, [paymentModelMeta]);
  // Cache de labels dos subtipos referenciados em subtype_split_hint — usado
  // no resumo "187 Parecer + 2 Visita" do preview.
  const [subtypeLabels, setSubtypeLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!paymentModelId) { setPaymentModelMeta(null); return; }
    let cancelled = false;
    (async () => {
      // O `paymentModelId` da URL/state vem da view `payment_types_unified`
      // (UNION de `item_types` + `payment_models`), então esse UUID pode NÃO
      // existir em `payment_types` — que é o alvo da FK `payments.payment_model_id`.
      // Resolvemos primeiro pelo `code` (existe em ambas) e usamos o id legado
      // de `payment_types` como `meta.id`, garantindo insert válido.
      let legacyRow: any = null;
      const direct = await supabase
        .from("payment_types")
        .select("id,code,label,tuss_default,requires_tuss_in_sheet,default_function,default_value_column_hint,expected_headers,allow_mixed_subtypes,subtype_split_hint")
        .eq("id", paymentModelId)
        .maybeSingle();
      if (direct.data) {
        legacyRow = direct.data;
      } else {
        const unified = await (supabase.from as any)("payment_types_unified")
          .select("code")
          .eq("id", paymentModelId)
          .maybeSingle();
        const code = unified?.data?.code;
        if (code) {
          const byCode = await supabase
            .from("payment_types")
            .select("id,code,label,tuss_default,requires_tuss_in_sheet,default_function,default_value_column_hint,expected_headers,allow_mixed_subtypes,subtype_split_hint")
            .eq("code", code)
            .maybeSingle();
          legacyRow = byCode.data;
        }
      }
      const data = legacyRow;
      if (cancelled || !data) return;

      const hint = (data as any).subtype_split_hint ?? null;

      // Carrega catálogo de item_types para:
      //  - resolver o tipo canônico dos itens (payment_items.item_type_id);
      //  - reclassificar Consulta → Procedimento quando o TUSS da planilha não casar;
      //  - normalizar subtype_split_hint antigo, que pode vir com target_code ou ID legado.
      let dynamicFallbackItemTypeId: string | null = null;
      let consultaTussExtras: string[] = [];
      let selectedItemTypeId: string | null = null;
      let normalizedHint: SubtypeSplitHint = null;
      let labelBySubtypeId: Record<string, string> = {};
      try {
        const { data: itemTypes } = await supabase
          .from("item_types" as any)
          .select("id,code,label,tuss_codes_extra");
        const it = (itemTypes ?? []) as any[];
        const itemByCode = new Map<string, any>(it.map((t) => [t.code, t]));
        const itemById = new Map<string, any>(it.map((t) => [t.id, t]));
        dynamicFallbackItemTypeId = itemByCode.get("procedimento")?.id ?? null;
        selectedItemTypeId = itemByCode.get(data.code)?.id ?? null;
        const consulta = it.find((t) => t.code === "consulta");
        consultaTussExtras = Array.isArray(consulta?.tuss_codes_extra) ? consulta.tuss_codes_extra : [];

        const { data: legacyTypes } = await supabase
          .from("payment_types")
          .select("id,code,label");
        const legacyById = new Map<string, any>(((legacyTypes ?? []) as any[]).map((t) => [t.id, t]));
        const rawHint = hint && hint.column && Array.isArray(hint.patterns) ? hint as any : null;
        if (rawHint) {
          const patterns = rawHint.patterns
            .map((p: any) => {
              if (!p?.match) return null;
              const rawTarget = p.target_item_type_id ?? p.target_payment_type_id ?? null;
              const targetCode = p.target_code
                ?? (rawTarget ? itemById.get(rawTarget)?.code : null)
                ?? (rawTarget ? legacyById.get(rawTarget)?.code : null)
                ?? null;
              const targetItemTypeId = targetCode
                ? itemByCode.get(targetCode)?.id ?? null
                : (rawTarget && itemById.has(rawTarget) ? rawTarget : null);
              if (!targetItemTypeId) return null;
              labelBySubtypeId[targetItemTypeId] = itemById.get(targetItemTypeId)?.label
                ?? (targetCode ? legacyById.get(rawTarget)?.label : null)
                ?? targetItemTypeId.slice(0, 6);
              return { match: p.match, target_item_type_id: targetItemTypeId } as SubtypePattern;
            })
            .filter(Boolean) as SubtypePattern[];
          normalizedHint = patterns.length > 0 ? { column: rawHint.column, patterns } : null;
        }
        if (selectedItemTypeId) {
          labelBySubtypeId[selectedItemTypeId] = itemById.get(selectedItemTypeId)?.label ?? data.label;
        }
      } catch { /* noop */ }

      const meta: PaymentTypeMeta = {
        id: data.id,
        code: data.code,
        label: data.label,
        tuss_default: (data as any).tuss_default ?? null,
        requires_tuss_in_sheet: (data as any).requires_tuss_in_sheet ?? true,
        default_function: (data as any).default_function ?? null,
        default_value_column_hint: (data as any).default_value_column_hint ?? null,
        expected_headers: Array.isArray((data as any).expected_headers) ? (data as any).expected_headers : [],
        allow_mixed_subtypes: !!(data as any).allow_mixed_subtypes,
        subtype_split_hint: normalizedHint,
        consulta_tuss_extras: consultaTussExtras,
        dynamic_fallback_item_type_id: dynamicFallbackItemTypeId,
        item_type_id: selectedItemTypeId,
      };
      setPaymentModelMeta(meta);

      if (!cancelled) setSubtypeLabels(labelBySubtypeId);
    })();
    return () => { cancelled = true; };
  }, [paymentModelId]);
  const [importMode, setImportMode] = useState<"normal" | "historico">("normal");
  // Relatório de pareceres anexado no wizard (modo confecção + tipo parecer).
  const [parecerPayload, setParecerPayload] = useState<ParecerWizardPayload | null>(null);
  const isParecerType = !!paymentModelMeta?.code?.startsWith("parecer");
  const isVisitaType = paymentModelMeta?.code === "visita";
  // Lote MISTO: produção que também tem parecer/visita misturados nos TUSS.
  // Em confecção + rateio + Parecer, também exibimos a opção: o lote pode ser
  // uma base única de Parecer/Visita e o relatório do Tasy decide cada item.
  const [mixedParecer, setMixedParecer] = useState<MixedParecerSetup>({ enabled: false, item_type_id: null });
  const showMixedParecerOption = !!paymentModelMeta && (
    (!isParecerType && !isVisitaType) ||
    (modoConfeccao && isParecerType)
  );
  const ambiguousTussCount = useAmbiguousTussCount();
  const requiresParecerReport = (modoConfeccao && isParecerType) || (showMixedParecerOption && mixedParecer.enabled);
  // Gate de especialidade só vale em confecção parecer puro (decide Parecer vs Visita por especialidade).
  // Em lote misto, a classificação é por TUSS ambíguo + relatório — especialidade não é obrigatória em todo item.
  const requiresSpecialtyOnAllRows = modoConfeccao && isParecerType;
  // Especialidade é obrigatória em todo item de confecção parecer.
  // Quando a base Tasy não traz, o modal abaixo coleta antes do submit.
  const [specialtyOverrides, setSpecialtyOverrides] = useState<Record<string, string>>({});
  const [specialtyModalOpen, setSpecialtyModalOpen] = useState(false);
  const isHistoricoImport = importMode === "historico";

  const HISTORICO_WINDOW = { start: "2026-01", end: "2026-04" };
  const competenceOutOfWindow = isHistoricoImport
    ? competenceMonths.some((m) => m < HISTORICO_WINDOW.start || m > HISTORICO_WINDOW.end)
    : false;

  // Handoff vindo da apuração retroativa (TASY vs Repasse): persistido no backend
  // via summary.handoff e referenciado pelo query param ?retro=<id>. Sobrevive a
  // reload porque a URL carrega o ID — sem dependência de sessionStorage.
  const [retroHandoff, setRetroHandoff] = useState<{
    reconciliation_id: string;
    reference?: string;
    description?: string;
    items_count?: number;
    total_complementar?: number;
    total_retirar?: number;
    prefilled_count?: number;
  } | null>(null);
  const retroPrefillDoneRef = useRef<string | null>(null);
  useEffect(() => {
    const retroId = searchParams.get("retro");
    if (!retroId) return;
    if (retroPrefillDoneRef.current === retroId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("retroactive_reconciliations" as never)
          .select("id, title, summary, company_id, period_start, period_end")
          .eq("id", retroId)
          .maybeSingle();
        if (cancelled || error || !data) return;
        const row = data as {
          id: string;
          title: string | null;
          summary: Record<string, unknown> | null;
          company_id: string | null;
          period_start: string | null;
          period_end: string | null;
        };
        const handoff = (row.summary?.handoff ?? {}) as {
          payment_id?: string | null;
          payment_reference?: string | null;
          items_count?: number;
          total_complementar?: number;
          total_retirar?: number;
        };
        if (handoff.payment_id) {
          // Apuração já vinculada a um pagamento — não permite duplicar.
          toast({
            title: "Apuração já encaminhada",
            description: "Esta apuração já está vinculada a um pagamento existente.",
            variant: "destructive",
          });
          return;
        }
        const refSuggestion = handoff.payment_reference || `Retro #${row.id.slice(0, 8)} · ${row.title ?? "TASY vs Repasse"}`;
        const descSuggestion =
          `Origem: apuração retroativa TASY vs Repasse (id ${row.id}).\n` +
          `Itens encaminhados: ${handoff.items_count ?? 0}.\n` +
          (typeof handoff.total_complementar === "number"
            ? `Complementar previsto: R$ ${handoff.total_complementar.toFixed(2)} · Retirar: R$ ${(handoff.total_retirar ?? 0).toFixed(2)}.`
            : "");

        const [{ data: companyRow }, { data: savedItems }] = await Promise.all([
          row.company_id
            ? supabase.from("companies" as never).select("id,name").eq("id", row.company_id).maybeSingle()
            : Promise.resolve({ data: null } as { data: null }),
          supabase
            .from("retroactive_reconciliation_items" as never)
            .select("id, raw")
            .eq("reconciliation_id", row.id)
            .eq("source", "tasy_vs_repasse")
            .order("created_at", { ascending: true }),
        ]);
        const company = companyRow as { id: string; name: string } | null;
        const tvrRows = ((savedItems ?? []) as Array<{ id: string; raw?: { tvr_result?: unknown } }>)
          .map((it) => ({ reconciliation_item_id: it.id, result: it.raw?.tvr_result as RetroTvrResult | undefined }))
          .filter((it): it is { reconciliation_item_id: string; result: RetroTvrResult } => !!it.result && isRetroComplementar(it.result));

        const paymentItemIds = Array.from(new Set(
          tvrRows.map((it) => it.result.matched_payment_item_id).filter((v): v is string => !!v),
        ));
        const paymentItemsById = new Map<string, Record<string, unknown>>();
        if (paymentItemIds.length > 0) {
          const { data: paidRows } = await supabase
            .from("payment_items" as never)
            .select("id, doctor_name, doctor_document, doctor_email, doctor_id, doctor_role, company_name, company_id, agreement_text, convenio_slug, sector, sector_slug, access_route, procedure_date, patient_name, procedure_name, specialty, attendance_character, cost_center_code, raw_data")
            .in("id", paymentItemIds);
          for (const paid of (paidRows ?? []) as Array<Record<string, unknown>>) {
            paymentItemsById.set(String(paid.id), paid);
          }
        }

        const sectorFallback = Array.from(paymentItemsById.values())
          .map((p) => String(p.sector_slug ?? p.sector ?? "").trim())
          .find(Boolean) || null;
        const costCenterFallback = Array.from(paymentItemsById.values())
          .map((p) => String(p.cost_center_code ?? "").trim())
          .find(Boolean) || null;

        if (tvrRows.length > 0) {
          const sourceRows = tvrRows.map(({ reconciliation_item_id, result }) => {
            const paid = result.matched_payment_item_id ? paymentItemsById.get(result.matched_payment_item_id) : undefined;
            const qty = retroComplementQuantity(result);
            const totalBase = retroComplementBase(result);
            const unitBase = qty > 0 ? Number((totalBase / qty).toFixed(2)) : totalBase;
            return {
              Empresa: String(paid?.company_name ?? company?.name ?? ""),
              Médico: String(paid?.doctor_name ?? result.medico ?? ""),
              Documento: String(paid?.doctor_document ?? ""),
              Email: String(paid?.doctor_email ?? ""),
              "Nr. Atendimento": result.atendimento ?? "",
              Paciente: String(paid?.patient_name ?? result.paciente ?? ""),
              Data: String(paid?.procedure_date ?? result.data ?? ""),
              Convênio: String(paid?.agreement_text ?? paid?.convenio_slug ?? result.convenio ?? ""),
              "Código TUSS": result.tuss ?? "",
              "Proced/Mat": String(paid?.procedure_name ?? result.procedimento ?? ""),
              "Via de Acesso": String(paid?.access_route ?? ""),
              Função: String(paid?.doctor_role ?? result.funcao ?? result.funcoes_pagas ?? ""),
              Setor: String(paid?.sector_slug ?? paid?.sector ?? sectorFallback ?? ""),
              Qtd: qty,
              "Valor Procedimento": unitBase,
              "Valor Total TVR": Number(totalBase.toFixed(2)),
              "Status TVR": result.status ?? "",
              "Origem TVR": result.key ?? `${result.atendimento ?? ""}|${result.tuss ?? ""}`,
            };
          });
          const file = buildRetroWorkbookFile(sourceRows, `confeccao-retro-${row.id.slice(0, 8)}.xlsx`);
          const parsedRows: ParsedRow[] = sourceRows.map((raw, idx) => {
            const linked = tvrRows[idx];
            const paid = linked.result.matched_payment_item_id ? paymentItemsById.get(linked.result.matched_payment_item_id) : undefined;
            const base = {
              doctor_name: String(raw["Médico"] ?? ""),
              doctor_document: String(raw["Documento"] ?? ""),
              doctor_email: String(raw["Email"] ?? ""),
              description: String(raw["Proced/Mat"] ?? ""),
              gross_amount: Number(raw["Valor Procedimento"] ?? 0),
              company_name: String(raw["Empresa"] ?? "") || null,
              company_id: String(paid?.company_id ?? company?.id ?? row.company_id ?? "") || null,
              attendance_number: String(raw["Nr. Atendimento"] ?? ""),
              procedure_code: String(raw["Código TUSS"] ?? ""),
              procedure_name: String(raw["Proced/Mat"] ?? ""),
              access_route: String(raw["Via de Acesso"] ?? ""),
              doctor_role: String(raw["Função"] ?? ""),
              agreement_text: String(raw["Convênio"] ?? ""),
              specialty: String(paid?.specialty ?? "") || null,
              procedure_amount: Number(raw["Valor Procedimento"] ?? 0),
              quantity: Number(raw["Qtd"] ?? 1) || 1,
              procedure_date: String(raw["Data"] ?? "") || null,
              procedure_date_has_time: false,
              patient_name: String(raw["Paciente"] ?? ""),
              sector: String(raw["Setor"] ?? "") || null,
              attendance_character: String(paid?.attendance_character ?? ""),
              raw_data: {
                ...raw,
                retro_reconciliation_id: row.id,
                retro_reconciliation_item_id: linked.reconciliation_item_id,
                retro_tvr_result: linked.result,
              },
              source_file: file.name,
              source_row_number: idx + 2,
              tipo_linha_manual: "procedimento" as LineType,
            };
            const tipo_linha = base.tipo_linha_manual;
            const withType = { ...base, tipo_linha };
            return { ...withType, line_issues: validateLine(withType, { modoConfeccao }) } as ParsedRow;
          });
          const headers = Object.keys(sourceRows[0] ?? {});
          setBuckets([{
            file,
            rows: parsedRows,
            rawCompanyName: company?.name ?? "Apuração retroativa",
            matchedCompany: company ? { id: company.id, name: company.name } : null,
            matchScore: company ? 1 : 0,
            sectorMapping: sectorFallback,
            sectorMissing: false,
            convenioValueTotalized: false,
            rawMatrix: [headers, ...sourceRows.map((r) => headers.map((h) => (r as Record<string, unknown>)[h]))],
            headerRowIndex: 0,
            sectorColumnUsed: "Setor",
          }]);
          if (costCenterFallback) setCostCenterCode((cur) => cur || costCenterFallback);
          setCompetenceMonths((cur) => cur.length ? cur : monthsBetween(row.period_start, row.period_end));
          setPaymentKind((cur) => cur || "pendencia");
          setAnalysisMode("confeccao");
        }

        setRetroHandoff({
          reconciliation_id: row.id,
          reference: refSuggestion,
          description: descSuggestion,
          items_count: handoff.items_count,
          total_complementar: handoff.total_complementar,
          total_retirar: handoff.total_retirar,
          prefilled_count: tvrRows.length,
        });
        setReference((cur) => cur || refSuggestion);
        setDescription((cur) => cur || descSuggestion);
        retroPrefillDoneRef.current = retroId;
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [searchParams]);
  useEffect(() => {
    // Consome a marca após montar, evitando que uma navegação posterior
    // para /pagamentos/novo sem param herde indevidamente o modo anterior.
    try { sessionStorage.removeItem("newPaymentMode"); } catch { /* ignore */ }
  }, []);
  // Tipos de pagamento são gerenciados em /cadastros/tipos-pagamento e carregados via hook.
  const { list: paymentTypeOptions, loading: loadingPaymentTypes } = usePaymentTypes({ onlyActive: true });

  // === Vínculo com rateio (pool) ===
  const [paymentMode, setPaymentMode] = useState<"producao" | "rateio">("producao");
  const [competenceRegime, setCompetenceRegime] = useState<"producao" | "remessa">("producao");
  const [poolId, setPoolId] = useState<string>("");
  const [poolDeductionId, setPoolDeductionId] = useState<string>("");
  const [rateioSource, setRateioSource] = useState<"planilha" | "sintetico">("planilha");
  const [rateioValorTotal, setRateioValorTotal] = useState<string>("");
  const [poolsList, setPoolsList] = useState<Array<{ id: string; nome: string }>>([]);
  const [poolDeductionsList, setPoolDeductionsList] = useState<Array<{ id: string; descricao: string; tipo: string; valor_variavel: boolean | null }>>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("pools").select("id, nome").eq("ativo", true).order("nome");
      if (alive) setPoolsList((data ?? []) as any);
    })();
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    let alive = true;
    setPoolDeductionId("");
    if (!poolId) { setPoolDeductionsList([]); return; }
    (async () => {
      const { data } = await supabase
        .from("pool_deductions")
        .select("id, descricao, tipo, valor_variavel")
        .eq("pool_id", poolId)
        .order("ordem");
      if (alive) setPoolDeductionsList((data ?? []) as any);
    })();
    return () => { alive = false; };
  }, [poolId]);

  // Empresas participantes do pool de rateio (com share > 0) — alimenta o painel de risco.
  const [poolCompanyNames, setPoolCompanyNames] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    if (!poolId || paymentMode !== "rateio") { setPoolCompanyNames([]); return; }
    (async () => {
      const { data } = await supabase
        .from("pool_participants")
        .select("company_id, percentual, companies:companies!inner(name)")
        .eq("pool_id", poolId)
        .gt("percentual", 0);
      if (!alive) return;
      const names = Array.from(new Set(
        (data ?? [])
          .map((r: any) => (r.companies?.name ?? "").trim())
          .filter(Boolean)
      ));
      setPoolCompanyNames(names);
    })();
    return () => { alive = false; };
  }, [poolId, paymentMode]);
  // Heurística: tipo de pagamento "plantão" habilita auto-vínculo com dedução variável do pool.
  const isPlantaoType = useMemo(() => {
    const t = paymentTypeOptions.find((o) => o.code === paymentType);
    const blob = `${t?.code ?? ""} ${t?.label ?? ""}`.toLowerCase();
    return /plant(a|ã)o/.test(blob);
  }, [paymentType, paymentTypeOptions]);

  // Sincroniza o Select visível com o id escolhido no pré-wizard. Ver hook
  // para detalhes — coberto por src/hooks/__tests__/usePaymentTypeCodeSync.test.tsx.
  usePaymentTypeCodeSync({
    paymentTypeId: paymentModelId,
    paymentTypeOptions,
    paymentType,
    setPaymentType: (code) => setPaymentType(code as PaymentType),
  });
  const [autoSectors, setAutoSectors] = useState(true);
  const [autoSpecialties, setAutoSpecialties] = useState(true);
  const [autoPaymentKind, setAutoPaymentKind] = useState(true);

  // ===== Autosave / rascunho =====
  // Decisões por arquivo aguardando re-anexação (após reload). Aplicadas no onFiles.
  const pendingFileDecisionsRef = useRef<Record<string, FileDecision>>({});
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(null);
  const draftLoadedRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const draftClearedRef = useRef(false);

  useEffect(() => { document.title = "Nova base | Exacta Approval"; }, []);


  // Evita que o navegador abra o arquivo (navegação) se o usuário soltar
  // fora da área de upload, o que aparenta um "refresh" e descarta o trabalho.
  useEffect(() => {
    const prevent = (e: DragEvent) => { e.preventDefault(); };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    if (buckets.length === 0 || submitting) return;
    const preventRefresh = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", preventRefresh);
    return () => window.removeEventListener("beforeunload", preventRefresh);
  }, [buckets.length, submitting]);

  const loadCompanies = useCallback(async () => {
    if (companiesLoadPromiseRef.current) return companiesLoadPromiseRef.current;

    companiesLoadPromiseRef.current = (async () => {
      // Cache curto em sessionStorage (60s) — evita re-fetch quando o usuário
      // navega entre telas e reduz pressão no pool durante picos de import.
      const CACHE_KEY = "newpayment.companies.cache.v1";
      const CACHE_TTL_MS = 5 * 60_000;
      try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { at: number; rows: CompanyRow[] };
          if (parsed && Date.now() - parsed.at < CACHE_TTL_MS && Array.isArray(parsed.rows)) {
            companiesRef.current = parsed.rows;
            setCompanies(parsed.rows);
            return parsed.rows;
          }
        }
      } catch { /* ignore */ }

      const pageSize = 500;
      const all: CompanyRow[] = [];

      const fetchPage = async (afterId: string | null) => {
        // Retry com backoff exponencial p/ timeouts (57014) e falhas transitórias.
        let lastErr: any = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          let q = supabase
            .from("companies")
            .select("id,name,aliases")
            .order("id", { ascending: true })
            .limit(pageSize);
          if (afterId) q = q.gt("id", afterId);
          const { data, error } = await q;
          if (!error) return data ?? [];
          lastErr = error;
          const isTimeout = (error as any)?.code === "57014";
          if (!isTimeout && attempt >= 1) break;
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
        throw lastErr;
      };

      let afterId: string | null = null;
      for (;;) {
        const data = await fetchPage(afterId);
        const page = (data ?? []).map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] }));
        all.push(...page);
        if (page.length < pageSize) break;
        const next = page[page.length - 1]?.id ?? null;
        if (!next || next === afterId) break;
        afterId = next;
      }

      all.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      companiesRef.current = all;
      setCompanies(all);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows: all }));
      } catch { /* quota — ignore */ }
      return all;
    })();

    try {
      return await companiesLoadPromiseRef.current;
    } finally {
      companiesLoadPromiseRef.current = null;
    }
  }, []);


  /**
   * Mapeia um array de linhas JSON (já com cabeçalho correto) para ParsedRow[].
   * Extraído para que `parseFile` (carga inicial) e `applyHeaderRowOverride`
   * (troca manual da linha de cabeçalho) compartilhem a mesma lógica.
   */
  const mapJsonToRows = (
    json: Record<string, unknown>[],
    f: File,
    headerOffset: number,
    company: CompanyRow | null,
    filenameTrusted: boolean,
    rawCompanyName: string,
    sectorColumnOverride?: string | null,
    manualMapping?: ManualMapping,
  ): ParsedRow[] => {
    // Quando o tipo de pagamento (parecer/visita/consulta etc.) tem
    // procedimento FIXO — o próprio tipo injeta `tuss_default` e o nome do
    // procedimento é derivado do contexto — ignoramos qualquer mapeamento
    // de procedure_code/procedure_name que tenha vindo do analista ou de
    // template. Evita o bug histórico de uma coluna de DATA ser mapeada
    // como "nome do procedimento" e contaminar o motor de validação.
    const ptMetaForMap = paymentTypeMetaRef.current;
    const procFixedByType =
      !!ptMetaForMap?.tuss_default || ptMetaForMap?.requires_tuss_in_sheet === false;
    const sanitizedMapping = (() => {
      if (!procFixedByType || !manualMapping) return manualMapping;
      const { procedure_code: _pc, procedure_name: _pn, ...rest } = manualMapping;
      return rest as ManualMapping;
    })();
    return json.map((rawRow, rowIndex) => {
      // Quando o analista (ou um template) forneceu mapeamento explícito,
      // injetamos o valor da coluna escolhida em todas as chaves canônicas
      // que o pick() conhece. Assim os pick() abaixo encontram o valor certo
      // sem precisarmos refatorar todas as listas de sinônimos.
      const row = applyManualMappingShim(rawRow, sanitizedMapping);
      const role = toStr(pick(row, ["funcao", "função", "papel"]));
      // Resolução de gross_amount e procedure_amount com regra anti-override
      // por heurística. Lógica isolada em src/lib/resolvePaymentAmounts.ts
      // para permitir testes unitários puros (vê resolvePaymentAmounts.test.ts).
      const amounts = resolvePaymentAmounts(rawRow, sanitizedMapping);
      const r_qty = normalizeNumericValue(pick(row, ["qtd", "quantidade", "quant"]));

      const grossFromAny = amounts.gross_amount;
      const procedureAmountFinal = amounts.procedure_amount;
      const quantity = r_qty.value || null;
      const valor_invalido = amounts.valor_invalido || r_qty.invalid;


      const rowCompanyNameRaw = readRowCompanyName(rawRow, sanitizedMapping);
      let rowMatchedCompany: CompanyRow | null = null;
      if (!filenameTrusted && rowCompanyNameRaw) {
        const registry = companiesRef.current.length ? companiesRef.current : companies;
        const { company: matched, score: s } = matchCompany(rowCompanyNameRaw, registry);
        if (s >= MATCH_AUTO_THRESHOLD) rowMatchedCompany = matched;
      }
      const rawSector = sectorColumnOverride
        ? toStr(row[sectorColumnOverride])
        : toStr(pick(row, [
            "setor do pagamento", "setor", "setores",
            "unidade de atendimento", "unidade", "unidades",
            "departamento", "departamentos", "depto",
            "servico", "serviço",
            "lotacao", "lotação",
            "ala", "posto", "area", "área", "local", "localizacao", "localização",
          ]));
      const resolvedCompany = filenameTrusted
        ? company
        : (rowCompanyNameRaw ? rowMatchedCompany : company);
      const resolvedName = resolvedCompany?.name
        ?? (filenameTrusted ? company!.name : (rowCompanyNameRaw || rawCompanyName))
        ?? null;
      const company_source: "arquivo" | "planilha" | "none" =
        filenameTrusted
          ? "arquivo"
          : (rowMatchedCompany ? "planilha" : (resolvedCompany ? "arquivo" : "none"));


      const DOCTOR_EXCLUDES = ["solic", "solicitante", "requisit", "pedinte"];
      let doctorNameRaw = toStr(pick(row, [
        "medico parecerista", "médico parecerista", "parecerista",
        "medico executante", "médico executante", "executante",
        "medico executor", "médico executor",
        "medico", "médico", "nome", "prestador", "fornecedor",
      ], DOCTOR_EXCLUDES));
      if (!doctorNameRaw) {
        const repasseCell = pick(row, ["repasse"]);
        const s = toStr(repasseCell);
        if (s && isNaN(Number(s.replace(/[\sR$.,]/g, "")))) doctorNameRaw = s;
      }

      const base = {
        doctor_name: doctorNameRaw ?? "",
        doctor_document: toStr(pick(row, ["cpf", "cnpj", "documento", "doc"])) ?? "",
        doctor_email: toStr(pick(row, ["email", "e-mail"])) ?? "",
        description: toStr(pick(row, ["procedmat", "proced/mat", "proced.", "procedimento", "produto", "descricao", "descrição", "servico", "serviço"])) ?? "",
        gross_amount: grossFromAny,
        gross_explicit: amounts.grossAuthoritative,
        valor_invalido,
        company_name: resolvedName,
        company_id: resolvedCompany?.id ?? null,
        attendance_number: toStr(pick(row, ["nr atendimento", "n atendimento", "atendimento", "atend", "nratendim", "num conta", "nr conta"])),
        procedure_code: toStr(pick(row, ["codigo procedimento", "código procedimento", "codigoproc", "codproc", "cod. tuss", "tuss", "cod prd", "codigo produto"])),
        procedure_name: toStr(pick(row, ["procedmat", "proced/mat", "proced.", "procedimento", "produto", "produto - atributo"])),
        access_route: toStr(pick(row, ["via de acesso", "viaacesso", "via acesso"])),
        doctor_role: role,
        agreement_text: toStr(pick(row, ["convenio", "convênio", "acordo", "operadora", "plano"])),
        specialty: toStr(pick(row, [
          "especialidade", "especialid", "especialidade médica", "especialidade medica",
          "espec destino", "espec. dest", "espec dest", "especialidade destino",
        ])) || null,
        procedure_amount: procedureAmountFinal,
        quantity: quantity,
        ...(() => {
          const parsed = excelDateToISOWithFlag(pick(row, [
            "data procedimento", "data atendimento", "data dmy", "data",
            "dt resposta", "dt. resp", "dt resp", "data resposta",
            "dt solic", "dt. solic", "data solicitacao", "data solicitação",
          ]));
          return { procedure_date: parsed.iso, procedure_date_has_time: parsed.hasTime };
        })(),
        patient_name: toStr(pick(row, ["paciente", "nome paciente", "nm paciente", "nome do paciente"])),
        sector: rawSector,
        attendance_character: toStr(pick(row, ["tipo entrada","tipo de entrada","carater","caráter","carater atendimento","caráter atendimento","carater do atendimento","caráter do atendimento","tipo internacao","tipo internação"])),
        raw_data: rawRow,
        company_source,

        source_file: f.name,
        source_row_number: headerOffset + 2 + rowIndex,
      };

      // === Injeção de defaults do tipo de pagamento ===
      // Quando o analista marcou um tipo (ex.: Parecer Adulto), aplicamos:
      //  - tuss_default → preenche procedure_code vazio (planilhas de parecer
      //    não trazem coluna TUSS; sem isso a regra com filtro por código
      //    nunca casaria);
      //  - default_function → preenche doctor_role vazio (ex.: "Parecerista");
      // Defaults só atuam quando a célula está vazia — analista pode sempre
      // sobrescrever pela própria planilha.
      const ptMeta = paymentTypeMetaRef.current;
      let payment_type_id_override: string | null = null;
      if (ptMeta) {
        const procFixed = !!ptMeta.tuss_default || ptMeta.requires_tuss_in_sheet === false;
        const labelLower = (ptMeta.label || "").toLowerCase();
        const isConsultaHybrid = labelLower.includes("consulta");

        // Conjunto de TUSS aceitos como "ainda é Consulta".
        const normTuss = (s: string | null | undefined) => String(s ?? "").replace(/\D+/g, "");
        const acceptedConsultaTuss = new Set<string>();
        if (ptMeta.tuss_default) acceptedConsultaTuss.add(normTuss(ptMeta.tuss_default));
        (ptMeta.consulta_tuss_extras ?? []).forEach((c) => {
          const n = normTuss(c);
          if (n) acceptedConsultaTuss.add(n);
        });

        // Reclassificação Consulta → Procedimento quando a planilha trouxe
        // TUSS que não é de consulta. Planilha vence tudo, sem default.
        const planilhaTussNorm = normTuss(base.procedure_code);
        const shouldReclassifyOutOfConsulta =
          isConsultaHybrid
          && !!planilhaTussNorm
          && !acceptedConsultaTuss.has(planilhaTussNorm)
          && !!ptMeta.dynamic_fallback_item_type_id;

        if (shouldReclassifyOutOfConsulta) {
          payment_type_id_override = ptMeta.dynamic_fallback_item_type_id ?? null;
          (base.raw_data as any).__reclassified_from_consulta = planilhaTussNorm;
        } else if (procFixed) {
          // Tipo fixo: regra híbrida para Consulta (planilha vence se trouxer),
          // sempre-sobrescreve para Parecer/Visita.
          const planilhaTemTuss = !!base.procedure_code;
          const planilhaTemNome = !!base.procedure_name;
          if (ptMeta.tuss_default && (!isConsultaHybrid || !planilhaTemTuss)) {
            base.procedure_code = ptMeta.tuss_default;
            (base.raw_data as any).__tuss_default_applied = ptMeta.tuss_default;
          }
          if (!isConsultaHybrid || !planilhaTemNome) {
            const especDest = toStr(pick(rawRow, [
              "espec dest", "espec. dest", "especialidade destino",
              "especialidade do parecerista", "especialidade",
            ]));
            const baseName = ptMeta.label || "Procedimento";
            base.procedure_name = especDest ? `${baseName} - ${especDest}` : baseName;
            (base.raw_data as any).__procedure_name_defaulted = base.procedure_name;
          }
        } else {
          if (!base.procedure_code && ptMeta.tuss_default) {
            base.procedure_code = ptMeta.tuss_default;
            (base.raw_data as any).__tuss_default_applied = ptMeta.tuss_default;
          }
        }
        if (!base.doctor_role && ptMeta.default_function) {
          base.doctor_role = ptMeta.default_function;
          (base.raw_data as any).__role_default_applied = ptMeta.default_function;
        }
        if (ptMeta.default_function) {
          base.sector = null;
          (base.raw_data as any).__sector_skipped_by_payment_type = true;
        }
      }

      // === Subtipos mistos (Parecer + Visita) ===
      // Quando o tipo permite mistura, avaliamos `subtype_split_hint`
      // (coluna + lista de padrões) para definir o payment_type_id REAL de
      // cada linha. Vazio = mantém o tipo pai escolhido na criação da base.
      // Match é case-insensitive, regex se a string começar com `/` ou
      // substring caso contrário.
      if (ptMeta?.allow_mixed_subtypes && ptMeta.subtype_split_hint) {

        const hint = ptMeta.subtype_split_hint;
        const cellRaw = row[hint.column];
        const cell = (cellRaw == null ? "" : String(cellRaw)).toLowerCase();
        if (cell) {
          for (const p of hint.patterns) {
            if (!p.match || !p.target_item_type_id) continue;
            const m = p.match.trim();
            let hit = false;
            if (m.startsWith("/") && m.lastIndexOf("/") > 0) {
              try {
                const lastSlash = m.lastIndexOf("/");
                const re = new RegExp(m.slice(1, lastSlash), m.slice(lastSlash + 1) || "i");
                hit = re.test(cell);
              } catch { hit = false; }
            } else {
              hit = cell.includes(m.toLowerCase());
            }
            if (hit) {
              payment_type_id_override = p.target_item_type_id;
              (base.raw_data as any).__subtype_split_matched = m;
              break;
            }
          }
        }
      }

      const tipo_linha = classifyLine(base, paymentKind || null);
      const withType = { ...base, tipo_linha, payment_type_id_override };
      const line_issues = validateLine(withType, { modoConfeccao });
      return { ...withType, line_issues } as ParsedRow;
    }).filter((r) => r.doctor_name || Math.abs(r.gross_amount) > 0 || r.procedure_code || r.description);
  };

  const mapSectorFromRaw = (raw: string | null): RuleSector | null => {
    if (!raw) return null;
    const normalize = (s: string) =>
      s.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/\(.*?\)/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const normRaw = normalize(raw);
    if (!normRaw) return null;
    for (const [key, label] of Object.entries(RULE_SECTOR_LABELS)) {
      const normLabel = normalize(label);
      if (!normLabel) continue;
      if (normRaw.includes(normLabel) || normLabel.includes(normRaw)) {
        return key as RuleSector;
      }
    }
    return null;
  };

  const parseFile = async (f: File): Promise<FileBucket> => {
    // 1) Extensão suportada
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      throw new ParseFileError(
        "Formato de arquivo não suportado",
        [`A extensão ".${ext || "?"}" não é reconhecida.`],
        ["Exporte a planilha como .xlsx, .xls ou .csv e tente novamente."],
      );
    }

    // 2) Leitura do workbook
    let wb: XLSX.WorkBook;
    try {
      const buf = await f.arrayBuffer();
      wb = readWorkbookPreservingText(buf, { cellDates: false });
    } catch (e) {
      throw new ParseFileError(
        "Não foi possível ler a planilha",
        [`O arquivo parece corrompido ou não é uma planilha válida (${String((e as Error)?.message ?? e)}).`],
        ["Abra o arquivo no Excel/Google Sheets, salve novamente como .xlsx e tente reenviar."],
      );
    }

    // 3) Workbook tem abas
    if (!wb.SheetNames?.length) {
      throw new ParseFileError(
        "Planilha sem abas",
        ["O arquivo não contém nenhuma aba de dados."],
        ["Adicione uma aba com os dados de pagamento e reenvie."],
      );
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    preserveFormattedBrazilianNumbers(sheet);
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });

    // 4) Conteúdo mínimo
    if (matrix.length === 0) {
      throw new ParseFileError(
        "Planilha vazia",
        [`A primeira aba ("${wb.SheetNames[0]}") não contém linhas.`],
        ["Verifique se você está enviando o arquivo certo e se a aba com os dados é a primeira."],
      );
    }

    const headerIdx = detectHeaderRow(matrix);
    const json = matrixToJson(matrix, headerIdx);

    // 5) Cabeçalho detectado tem colunas
    const headerCells = (matrix[headerIdx] ?? []) as unknown[];
    const headerNames = headerCells.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (headerNames.length === 0) {
      throw new ParseFileError(
        "Cabeçalho não identificado",
        ["Nenhuma linha da planilha foi reconhecida como cabeçalho válido."],
        [
          "Confirme se a primeira aba contém uma linha com os nomes das colunas (ex: Médico, Valor, Procedimento).",
          "Após o upload, use o botão \"Cabeçalho: linha N\" para escolher manualmente a linha correta.",
        ],
      );
    }

    let companyRegistry: CompanyRow[] = [];
    try {
      companyRegistry = await loadCompanies();
    } catch (error) {
      console.warn("[NewPayment] loadCompanies during parse", error);
      companyRegistry = companiesRef.current.length ? companiesRef.current : companies;
      toast({
        title: "Empresas não carregaram automaticamente",
        description: "O arquivo foi lido mesmo assim. Se a PJ não for reconhecida, selecione manualmente no card do arquivo.",
        variant: "destructive",
      });
    }
    const rawCompanyName = extractCompanyFromFilename(f.name);
    const { company, score } = matchCompany(rawCompanyName, companyRegistry);

    // Detecta a coluna "setor" cruzando cabeçalho + valores com sectores cadastrados.
    // Só auto-aplica quando o NOME do cabeçalho bate explicitamente (ex.: "Setor",
    // "Unidade de Atendimento"). Quando a detecção foi por valores, deixamos
    // para o usuário confirmar manualmente — nunca inferimos sozinhos.
    const sectorAliasesMap = await loadSectorAliases(hospital?.id ?? null);
    const detection = detectSectorColumn(headerNames, json, sectorAliasesMap.resolveSlug);
    const autoSectorColumn = detection.confidence === "header" ? detection.recommended : null;

    // Tenta achar template salvo com a mesma assinatura de cabeçalho.
    // Quando encontra, aplica automaticamente e marca para incrementar o use_count.
    let appliedTemplate: { id: string; name: string } | null = null;
    let manualMapping: ManualMapping | undefined;
    try {
      const tpl = await findMatchingTemplateRef.current(headerNames);
      if (tpl) {
        manualMapping = tpl.mapping;
        appliedTemplate = { id: tpl.id, name: tpl.name };
        void markTemplateUsedRef.current(tpl.id);
      }
    } catch (e) {
      console.warn("[mapping-template] lookup failed", e);
    }

    const filenameTrusted = shouldTrustFilenameCompany(score, company, json, manualMapping);
    const rows = mapJsonToRows(json, f, headerIdx, company, filenameTrusted, rawCompanyName, autoSectorColumn, manualMapping);

    // 6) Colunas obrigatórias presentes
    const hasDoctor = rows.some((r) => r.doctor_name && r.doctor_name.trim().length > 0);
    const hasValue = rows.some((r) => Math.abs(r.gross_amount) > 0 || (r.procedure_amount ?? 0) > 0);
    const missing: string[] = [];
    if (!hasDoctor) missing.push("Médico (Médico, Prestador, Executante, Parecerista)");
    if (!hasValue) missing.push("Valor (Valor Bruto, Valor Repasse ou Valor Procedimento)");
    if (missing.length > 0) {
      throw new ParseFileError(
        "Colunas obrigatórias ausentes",
        [
          `As seguintes colunas não foram encontradas após o cabeçalho (linha ${headerIdx + 1}):`,
          ...missing.map((m) => `• ${m}`),
          `Colunas detectadas: ${headerNames.slice(0, 10).join(" · ")}${headerNames.length > 10 ? " …" : ""}`,
        ],
        [
          "Renomeie as colunas da planilha para um dos nomes aceitos acima.",
          "Se o cabeçalho está em outra linha, use o botão \"Cabeçalho: linha N\" após o upload.",
          "Se os nomes estão corretos mas em formato diferente, use \"Colunas\" para mapear manualmente.",
        ],
      );
    }

    // 7) Linhas úteis após filtro
    if (rows.length === 0) {
      throw new ParseFileError(
        "Nenhuma linha de pagamento encontrada",
        [
          `A planilha foi lida (cabeçalho na linha ${headerIdx + 1}) mas nenhuma linha de dados foi reconhecida.`,
          "Linhas precisam ter ao menos: nome do médico OU valor OU código de procedimento.",
        ],
        [
          "Confirme se há dados abaixo do cabeçalho.",
          "Se houver linhas de totalizador/subtotal antes da tabela, escolha a linha de cabeçalho correta após o upload.",
        ],
      );
    }

    const sectorCounts: Record<string, number> = {};
    for (const r of rows) {
      if (r.sector) {
        const s = r.sector.toLowerCase().trim();
        sectorCounts[s] = (sectorCounts[s] ?? 0) + 1;
      }
    }
    const dominantSectorRaw = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const dominantMapped = mapSectorFromRaw(dominantSectorRaw);
    const sectorMissing = rows.length > 0 && (Object.keys(sectorCounts).length === 0 || dominantMapped === null);

    // Hits do mapeamento (com override aplicado se houver template/manual)
    const baseHits = inspectColumnMapping(headerNames);
    const mappingHits: FieldMappingHit[] = baseHits.map((h) => {
      const override = manualMapping?.[h.field];
      if (override && headerNames.includes(override)) {
        return { ...h, header: override, score: 100, confidence: "high" as const };
      }
      return h;
    });
    const sampleRow = json[0] ?? null;

    return {
      file: f,
      rows,
      rawCompanyName,
      matchedCompany: company ? { id: company.id, name: company.name } : null,
      matchScore: score,
      sectorMapping: dominantMapped,
      sectorMissing,
      rawMatrix: matrix,
      headerRowIndex: headerIdx,
      sectorColumnDetection: detection,
      sectorColumnUsed: autoSectorColumn,
      detectedHeaders: headerNames,
      sampleRow,
      mappingHits,
      columnMapping: manualMapping,
      appliedTemplate,
    };
  };

  /**
   * Reaplica o parsing usando uma linha de cabeçalho escolhida manualmente.
   * Útil quando o auto-detect erra (planilhas com cabeçalhos atípicos ou
   * metadados extras antes da tabela).
   */
  const applyHeaderRowOverride = (idx: number, newHeaderIdx: number) => {
    setBuckets((prev) => prev.map((bucket, bIdx) => {
      if (bIdx !== idx) return bucket;
      const matrix = bucket.rawMatrix;
      if (!matrix) return bucket;
      const json = matrixToJson(matrix, newHeaderIdx);
      const registry = companiesRef.current.length ? companiesRef.current : companies;
      const company = bucket.matchedCompany
        ? (registry.find((c) => c.id === bucket.matchedCompany!.id) ?? null)
        : null;
      const filenameTrusted = shouldTrustFilenameCompany(bucket.matchScore, company, json, bucket.columnMapping);
      const rows = mapJsonToRows(json, bucket.file, newHeaderIdx, company, filenameTrusted, bucket.rawCompanyName, bucket.sectorColumnUsed ?? null, bucket.columnMapping);
      const sc: Record<string, number> = {};
      for (const r of rows) { if (r.sector) { const s = r.sector.toLowerCase().trim(); sc[s] = (sc[s] ?? 0) + 1; } }
      const dominantRaw = Object.entries(sc).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const dominantMapped = mapSectorFromRaw(dominantRaw);
      const sectorMissing = rows.length > 0 && (Object.keys(sc).length === 0 || dominantMapped === null);
      return { ...bucket, rows, headerRowIndex: newHeaderIdx, sectorMissing, sectorMapping: bucket.sectorMapping ?? dominantMapped };
    }));
    toast({ title: "Cabeçalho atualizado", description: `Linha ${newHeaderIdx + 1} usada como cabeçalho.` });
  };

  /**
   * Aplica/troca a coluna usada como SETOR em um bucket e reprocessa as linhas
   * lendo o valor dali. Mantém o usuário no controle — nada é inferido sozinho.
   */
  const applySectorColumn = (idx: number, columnName: string | null) => {
    setBuckets((prev) => prev.map((bucket, bIdx) => {
      if (bIdx !== idx) return bucket;
      const matrix = bucket.rawMatrix;
      const headerIdx = bucket.headerRowIndex ?? 0;
      if (!matrix) return { ...bucket, sectorColumnUsed: columnName };
      const json = matrixToJson(matrix, headerIdx);
      const registry = companiesRef.current.length ? companiesRef.current : companies;
      const company = bucket.matchedCompany
        ? (registry.find((c) => c.id === bucket.matchedCompany!.id) ?? null)
        : null;
      const filenameTrusted = shouldTrustFilenameCompany(bucket.matchScore, company, json, bucket.columnMapping);
      const rows = mapJsonToRows(json, bucket.file, headerIdx, company, filenameTrusted, bucket.rawCompanyName, columnName, bucket.columnMapping);
      const sc: Record<string, number> = {};
      for (const r of rows) { if (r.sector) { const s = r.sector.toLowerCase().trim(); sc[s] = (sc[s] ?? 0) + 1; } }
      const dominantRaw = Object.entries(sc).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      const dominantMapped = mapSectorFromRaw(dominantRaw);
      const sectorMissing = rows.length > 0 && (Object.keys(sc).length === 0 || dominantMapped === null);
      return { ...bucket, rows, sectorColumnUsed: columnName, sectorMissing, sectorMapping: bucket.sectorMapping ?? dominantMapped };
    }));
    toast({
      title: columnName ? `Coluna de setor: "${columnName}"` : "Coluna de setor: detecção automática",
      description: columnName ? "Os itens deste arquivo passaram a ler o setor desta coluna." : "Voltando ao detector automático por sinônimos.",
    });
  };

  /**
   * Compara dois conjuntos de cabeçalhos detectados de forma case/ordem-insensível.
   * Usado para propagar o mapeamento manual aos demais arquivos compatíveis do lote.
   */
  const sameHeaderSet = (a: string[] | undefined | null, b: string[] | undefined | null): boolean => {
    if (!a || !b) return false;
    if (a.length === 0 || b.length === 0) return false;
    const norm = (s: string) => s.trim().toLowerCase();
    const sa = Array.from(new Set(a.map(norm))).sort();
    const sb = Array.from(new Set(b.map(norm))).sort();
    if (sa.length !== sb.length) return false;
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
    return true;
  };

  /**
   * Aplica um override de mapeamento de colunas vindo do diálogo
   * (ou de um template salvo). Reprocessa as linhas com o novo mapping.
   * Quando `applyToCompatible=true`, propaga o mesmo mapping para todos os
   * outros buckets do lote que tenham exatamente os mesmos cabeçalhos.
   */
  const applyColumnMappingOverride = (idx: number, mapping: ManualMapping, applyToCompatible = false) => {
    const refHeaders = buckets[idx]?.detectedHeaders ?? [];
    let propagatedCount = 0;
    setBuckets((prev) => prev.map((bucket, bIdx) => {
      const isTarget = bIdx === idx;
      const isCompatible = !isTarget && applyToCompatible && sameHeaderSet(refHeaders, bucket.detectedHeaders);
      if (!isTarget && !isCompatible) return bucket;
      if (isCompatible) propagatedCount++;
      const matrix = bucket.rawMatrix;
      const headerIdx = bucket.headerRowIndex ?? 0;
      if (!matrix) return { ...bucket, columnMapping: mapping };
      const json = matrixToJson(matrix, headerIdx);
      const registry = companiesRef.current.length ? companiesRef.current : companies;
      const company = bucket.matchedCompany
        ? (registry.find((c) => c.id === bucket.matchedCompany!.id) ?? null)
        : null;
      const filenameTrusted = shouldTrustFilenameCompany(bucket.matchScore, company, json, mapping);
      const rows = mapJsonToRows(json, bucket.file, headerIdx, company, filenameTrusted, bucket.rawCompanyName, bucket.sectorColumnUsed ?? null, mapping);
      const baseHits = inspectColumnMapping(bucket.detectedHeaders ?? []);
      const mappingHits: FieldMappingHit[] = baseHits.map((h) => {
        const override = mapping[h.field];
        if (override && (bucket.detectedHeaders ?? []).includes(override)) {
          return { ...h, header: override, score: 100, confidence: "high" as const };
        }
        return h;
      });
      return { ...bucket, rows, columnMapping: mapping, mappingHits };
    }));
    toast({
      title: "Mapeamento de colunas atualizado",
      description: propagatedCount > 0
        ? `Aplicado a este arquivo + ${propagatedCount} arquivo${propagatedCount === 1 ? "" : "s"} com o mesmo cabeçalho.`
        : "As linhas foram reprocessadas com o novo mapeamento.",
    });
  };



  const reportParseError = (fileName: string, e: unknown) => {
    const pe = e instanceof ParseFileError
      ? { title: e.title, reasons: e.reasons, howToFix: e.howToFix }
      : { title: "Erro ao processar arquivo", reasons: [String((e as Error)?.message ?? e)], howToFix: ["Tente abrir o arquivo no Excel/Google Sheets e salvá-lo novamente como .xlsx."] };
    setParseErrors((prev) => [...prev, { fileName, ...pe }]);
    toast({
      title: `${pe.title} — ${fileName}`,
      description: [...pe.reasons, "", "Como corrigir:", ...pe.howToFix.map((s) => `• ${s}`)].join("\n"),
      variant: "destructive",
    });
  };

  const onFiles = async (fileList: FileList) => {
    const files = Array.from(fileList);
    // Parsing PARALELO com yields. Antes era sequencial (for + await), o que
    // bloqueava o main thread e fazia o sistema "cansar" nos últimos arquivos
    // de lotes grandes. Agora cada parse roda em paralelo (XLSX.read é pesado
    // mas o JS engine intercala melhor) e o setTimeout(0) inicial libera o
    // ciclo de render antes de cada parse começar.
    type ParseOk = { ok: true; bucket: FileBucket; file: File; error: null };
    type ParseErr = { ok: false; bucket: null; file: File; error: unknown };
    const results = await Promise.all<ParseOk | ParseErr>(
      files.map((f) =>
        new Promise<ParseOk | ParseErr>((resolve) => {
          setTimeout(async () => {
            try {
              const bucket = await parseFile(f);
              resolve({ ok: true, bucket, file: f, error: null });
            } catch (error) {
              resolve({ ok: false, bucket: null, file: f, error });
            }
          }, 0);
        }),
      ),
    );
    const newBuckets: FileBucket[] = [];
    for (const r of results) {
      if (r.ok && r.bucket) newBuckets.push(r.bucket);
      else if (!r.ok) reportParseError(r.file.name, r.error);
    }
    // Aplica decisões restauradas do rascunho (por chave nome::size::lastModified).
    const pending = pendingFileDecisionsRef.current;
    const merged = newBuckets.map((b) => {
      const k = fileKey(b.file);
      const dec = pending[k];
      if (!dec) return b;
      delete pending[k];
      return {
        ...b,
        sectorMapping: dec.sectorMapping ?? b.sectorMapping,
        matchedCompany: dec.matchedCompany ?? b.matchedCompany,
        // NUNCA inflar o score fresco só porque o rascunho tinha uma sugestão salva —
        // isso mascarava "requer confirmação" como "match 100%" após reload e o
        // analista deixava de ver que precisava confirmar. Só sobe pra 1.0 quando
        // houve confirmação manual explícita (manualOverride=true no rascunho).
        matchScore: dec.manualOverride ? Math.max(b.matchScore, 1) : b.matchScore,
        manualOverride: dec.manualOverride ?? b.manualOverride,
        convenioValueTotalized: dec.convenioValueTotalized ?? b.convenioValueTotalized,
        headerRowIndex: dec.headerRowIndex ?? b.headerRowIndex,
        sectorColumnUsed: dec.sectorColumnUsed ?? b.sectorColumnUsed,
        columnOverrides: (dec.columnOverrides as typeof b.columnOverrides) ?? b.columnOverrides,
        columnMapping: (dec.columnMapping as typeof b.columnMapping) ?? b.columnMapping,
      } as FileBucket;
    });
    const restoredCount = newBuckets.length - Object.keys(pending).length - (newBuckets.length - merged.filter((b, i) => b !== newBuckets[i]).length);
    const appliedCount = merged.filter((b, i) => b !== newBuckets[i]).length;
    setBuckets((prev) => {
      const next = [...prev, ...merged];
      // Para parecer/visita, abre automaticamente o mapeamento do primeiro
      // arquivo recém-adicionado para o analista confirmar qual coluna é a
      // descrição livre (o tipo já injeta TUSS e função, então o resto do
      // mapeamento gira em torno de descrição, datas e valores).
      const tussInjected =
        !!paymentTypeMetaRef.current?.tuss_default ||
        paymentTypeMetaRef.current?.requires_tuss_in_sheet === false;
      if (tussInjected && prev.length === 0 && merged.length > 0) {
        const firstIdx = 0;
        setTimeout(() => setMappingDialog({ open: true, bucketIdx: firstIdx }), 200);
      }
      return next;
    });
    if (appliedCount > 0) {
      toast({ title: "Decisões do rascunho aplicadas", description: `${appliedCount} arquivo(s) com setor/PJ/mapeamento restaurados.` });
    }
    if (!reference && newBuckets.length === 1) {
      setReference(newBuckets[0].file.name.replace(/\.[^.]+$/, ""));
    } else if (!reference && newBuckets.length > 1) {
      const today = new Date();
      setReference(`Pagamento ${today.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`);
    }
  };


  /** Substitui o arquivo de um bucket existente sem perder os demais arquivos do lote. */
  const replaceBucketFile = async (idx: number, f: File) => {
    try {
      const prev = buckets[idx];
      const fresh = await parseFile(f);
      // Preserva escolhas manuais que o analista já fez sobre este bucket —
      // trocar o arquivo (ex.: corrigir formato) não deve apagar empresa
      // manual, setor, mapeamento de colunas ou toggle de valor totalizado.
      const preservedCompany =
        prev?.manualOverride && prev.matchedCompany ? prev.matchedCompany : fresh.matchedCompany;
      const preservedManualOverride = prev?.manualOverride ?? false;
      const merged: FileBucket = {
        ...fresh,
        matchedCompany: preservedCompany,
        matchScore: preservedCompany && preservedManualOverride ? 1 : fresh.matchScore,
        manualOverride: preservedManualOverride || fresh.manualOverride,
        sectorMapping: prev?.sectorMapping ?? fresh.sectorMapping,
        convenioValueTotalized: prev?.convenioValueTotalized ?? fresh.convenioValueTotalized,
        columnMapping: prev?.columnMapping ?? fresh.columnMapping,
        columnOverrides: prev?.columnOverrides ?? fresh.columnOverrides,
        // Re-estampa empresa preservada nas linhas recém-parseadas.
        rows: preservedCompany
          ? fresh.rows.map((r) => ({ ...r, company_id: preservedCompany.id, company_name: preservedCompany.name }))
          : fresh.rows,
      };
      setBuckets((prevBuckets) => prevBuckets.map((b, i) => (i === idx ? merged : b)));
      toast({
        title: "Arquivo substituído",
        description: preservedManualOverride
          ? `${f.name} — empresa e ajustes anteriores preservados.`
          : f.name,
      });
    } catch (e) {
      reportParseError(f.name, e);
    }
  };



  const removeBucket = (idx: number) => setBuckets((prev) => prev.filter((_, i) => i !== idx));

  /**
   * Troca manual da empresa do arquivo + aprendizado: salva o `rawCompanyName`
   * (extraído do nome do arquivo) como alias da empresa correta, para que o
   * próximo match acerte sozinho. Atualiza também as linhas já parseadas.
   */
  const overrideBucketCompany = async (idx: number, picked: CompanyOption) => {
    const b = buckets[idx];
    if (!b) return;
    const previousId = b.matchedCompany?.id ?? null;
    // Atualiza o bucket localmente
    setBuckets((prev) =>
      prev.map((x, i) =>
        i === idx
          ? {
              ...x,
              matchedCompany: { id: picked.id, name: picked.name },
              matchScore: 1,
              manualOverride: true,
              rows: x.rows.map((r) => ({ ...r, company_id: picked.id, company_name: picked.name })),
            }
          : x,
      ),
    );
    // Aprendizado: usa o helper learnCompanyAlias, que chama a RPC SECURITY DEFINER
    // learn_company_alias. RLS de UPDATE em companies é restrita a admin/diretor,
    // então analistas precisam do bypass seguro da RPC. O helper retorna {ok, aliases?}
    // sem jogar exceção — caller decide o toast e atualiza o cache local.
    if (previousId !== picked.id) {
      const rawAlias = b.rawCompanyName?.trim() ?? "";
      if (rawAlias) {
        const res = await learnCompanyAlias(supabase, {
          companyId: picked.id,
          rawName: rawAlias,
        });
        if (!res.ok) {
          toast({
            title: "Empresa atualizada (sem aprender apelido)",
            description: `Troca aplicada, mas não foi possível salvar o apelido: ${res.error}`,
            variant: "destructive",
          });
        } else {
          companiesRef.current = companiesRef.current.map((c) =>
            c.id === picked.id ? { ...c, aliases: res.aliases } : c,
          );
          setCompanies((prev) =>
            prev.map((c) => (c.id === picked.id ? { ...c, aliases: res.aliases } : c)),
          );
          toast({
            title: "Empresa atualizada",
            description: `"${rawAlias}" foi salvo como apelido de ${picked.name}. Próximas importações com esse nome serão reconhecidas automaticamente.`,
          });
        }
      }
    }
  };
  
  /**
   * Confirma a sugestão automática de empresa (quando o match é < 90%).
   * Também aprende o `rawCompanyName` como apelido — ao confirmar, o analista
   * está validando que o nome bruto do arquivo se refere à empresa sugerida,
   * então registrar isso melhora o match das próximas importações.
   */
  const confirmBucketCompany = async (idx: number) => {
    const b = buckets[idx];
    if (!b || !b.matchedCompany) return;
    const picked = b.matchedCompany;

    setBuckets((prev) =>
      prev.map((x, i) =>
        i === idx
          ? {
              ...x,
              manualOverride: true,
              rows: x.rows.map((r) => ({
                ...r,
                company_id: picked.id,
                company_name: picked.name,
              })),
            }
          : x,
      ),
    );

    const rawAlias = b.rawCompanyName?.trim() ?? "";
    const registry = companiesRef.current.length ? companiesRef.current : companies;
    const candidate = registry.find((c) => c.id === picked.id);
    const mustLearn = shouldLearnAlias(rawAlias, candidate ?? null);

    if (mustLearn) {
      const res = await learnCompanyAlias(supabase, { companyId: picked.id, rawName: rawAlias });
      if (res.ok) {
        companiesRef.current = companiesRef.current.map((c) =>
          c.id === picked.id ? { ...c, aliases: res.aliases } : c,
        );
        setCompanies((prev) =>
          prev.map((c) => (c.id === picked.id ? { ...c, aliases: res.aliases } : c)),
        );
        toast({
          title: "Empresa confirmada",
          description: `"${rawAlias}" foi salvo como apelido de ${picked.name}.`,
        });
        return;
      }
      toast({
        title: "Empresa confirmada (sem aprender apelido)",
        description: `Confirmação aplicada, mas não foi possível salvar o apelido: ${res.error}`,
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Empresa confirmada",
      description: `A sugestão "${picked.name}" foi aceita para este arquivo.`,
    });
  };

  /**
   * Cadastro rápido de PJ direto do card de arquivo (fluxo de nova importação).
   * Cria a empresa, adiciona ao cache local e reaproveita `overrideBucketCompany`
   * para vincular + aprender apelido, evitando que o analista saia da tela
   * para cadastrar cada nova PJ do lote.
   */
  const registerAndBindNewCompany = async (
    idx: number,
    name: string,
    document: string,
  ): Promise<boolean> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Informe o nome da empresa", variant: "destructive" });
      return false;
    }
    const b = buckets[idx];
    if (!b) return false;
    const doc = document.trim() || null;
    const rawAlias = b.rawCompanyName?.trim() ?? "";
    const aliases = rawAlias && rawAlias !== trimmed ? [rawAlias] : [];
    try {
      const { data: created, error } = await supabase
        .from("companies")
        .insert({ name: trimmed, document: doc, aliases })
        .select("id, name, document, aliases")
        .single();
      if (error) throw error;

      // Atualiza cache local para o próximo match / combobox reconhecer.
      const nextRow: CompanyRow = {
        id: created.id,
        name: created.name,
        aliases: (created as any).aliases ?? aliases,
      };
      companiesRef.current = [...companiesRef.current, nextRow];
      setCompanies((prev) => [...prev, nextRow]);

      await overrideBucketCompany(idx, {
        id: created.id,
        name: created.name,
        document: (created as any).document ?? doc,
      });

      toast({
        title: "Empresa cadastrada",
        description: `${created.name} foi criada e vinculada ao arquivo.`,
      });
      return true;
    } catch (e: any) {
      toast({
        title: "Erro ao cadastrar empresa",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
      return false;
    }
  };

  const toggleBucketConvenioTotalized = (idx: number) => {
    setBuckets((prev) =>
      prev.map((x, i) => (i === idx ? { ...x, convenioValueTotalized: !x.convenioValueTotalized } : x))
    );
  };

  /**
   * Aplica override manual de colunas no bucket: re-extrai doctor_name,
   * gross_amount, procedure_amount e valor_invalido das linhas usando o
   * `raw_data` já salvo. Usado quando o auto-detect erra para planilhas
   * com cabeçalhos atípicos.
   */
  const applyColumnOverrides = (idx: number, overrides: ColumnOverrides) => {
    setBuckets((prev) =>
      prev.map((bucket, bIdx) => {
        if (bIdx !== idx) return bucket;
        const rows = bucket.rows.map((row) => {
          const raw = row.raw_data || {};
          const next: ParsedRow = { ...row };

          if (overrides.doctor) {
            const v = toStr(raw[overrides.doctor]);
            next.doctor_name = v ?? "";
          }
          const rRep = overrides.repasse ? normalizeNumericValue(raw[overrides.repasse]) : null;
          const rGross = overrides.gross ? normalizeNumericValue(raw[overrides.gross]) : null;
          if (rRep || rGross) {
            const repVal = rRep?.value ?? 0;
            const grossVal = rGross?.value ?? 0;
            next.gross_amount = repVal || grossVal || row.gross_amount;
            next.procedure_amount = grossVal || row.procedure_amount;
            next.valor_invalido = (rRep?.invalid ?? false) || (rGross?.invalid ?? false);
          }

          const tipo_linha = next.tipo_linha_manual ?? classifyLine(next, paymentKind || null);
          const withType = { ...next, tipo_linha };
          return { ...withType, line_issues: validateLine(withType, { modoConfeccao }) } as ParsedRow;
        });
        return { ...bucket, columnOverrides: overrides, rows };
      })
    );
    toast({ title: "Mapeamento aplicado", description: "Colunas reinterpretadas com seu mapeamento manual." });
  };


  const updateRow = (bucketIndex: number, rowIndex: number, changes: Partial<ParsedRow>) => {
    setBuckets((prev) =>
      prev.map((bucket, bIdx) =>
        bIdx !== bucketIndex
          ? bucket
          : {
              ...bucket,
              rows: bucket.rows.map((row, rIdx) => {
                if (rIdx !== rowIndex) return row;
                const merged = { ...row, ...changes } as ParsedRow;
                // Recalcula tipo_linha: override manual vence; senão re-classifica
                // com base nos novos valores (médico/valor/TUSS podem ter mudado).
                const tipo_linha = merged.tipo_linha_manual ?? classifyLine(merged, paymentKind || null);
                const withType = { ...merged, tipo_linha } as ParsedRow;
                return { ...withType, line_issues: validateLine(withType, { modoConfeccao }) } as ParsedRow;
              }),
            },
      ),
    );
  };


  // === Linhas suspeitas (totalizadores/rodapé) ===
  // Heurística no parser sinaliza linhas que parecem totalizador. O analista
  // decide caso a caso ("descartar" / "total informativo" remove da base;
  // "manter como item" preserva). Enquanto houver pendência, envio é bloqueado.
  const [suspiciousDecisions, setSuspiciousDecisions] = useState<Record<string, SuspiciousDecision>>({});
  const decisionKey = (fileName: string, rowNumber: number) => `${fileName}::${rowNumber}`;

  // ===== Carregar rascunho ao montar (uma vez por hospital/modo/tipo) =====
  useEffect(() => {
    if (draftLoadedRef.current) return;
    if (!hospital?.id) return; // espera hospital resolver
    draftLoadedRef.current = true;
    const draft = loadDraft(hospital.id, analysisMode, paymentModelId);
    if (!isDraftMeaningful(draft) || !draft) return;
    const f = draft.form ?? {};
    if (f.reference) setReference((cur) => cur || f.reference!);
    if (f.description) setDescription((cur) => cur || f.description!);
    if (f.competenceMonths?.length) setCompetenceMonths((cur) => cur.length ? cur : f.competenceMonths!);
    if (f.paymentDueDate) setPaymentDueDate((cur) => cur || f.paymentDueDate!);
    if (f.paymentKind) setPaymentKind((cur) => cur || (f.paymentKind as PaymentKind));
    if (f.paymentTrack) setPaymentTrack((cur) => cur || (f.paymentTrack as PaymentTrack));
    if (f.costCenterCode) setCostCenterCode((cur) => cur || f.costCenterCode!);
    if (f.pSectors?.length) setPSectors((cur) => cur.length ? cur : f.pSectors!);
    if (f.pSpecialties?.length) setPSpecialties((cur) => cur.length ? cur : f.pSpecialties!);
    if (typeof f.autoSectors === "boolean") setAutoSectors(f.autoSectors);
    if (typeof f.autoSpecialties === "boolean") setAutoSpecialties(f.autoSpecialties);
    if (typeof f.autoPaymentKind === "boolean") setAutoPaymentKind(f.autoPaymentKind);
    if (f.importMode === "historico" || f.importMode === "normal") setImportMode(f.importMode);
    if (draft.suspiciousDecisions) {
      setSuspiciousDecisions(draft.suspiciousDecisions as Record<string, SuspiciousDecision>);
    }
    if (draft.fileDecisions) {
      pendingFileDecisionsRef.current = draft.fileDecisions;
    }
    setDraftRestoredAt(draft.savedAt);
    const filesPending = Object.keys(draft.fileDecisions ?? {}).length;
    toast({
      title: "Rascunho restaurado",
      description: filesPending
        ? `Campos do formulário reaplicados. Re-anexe ${filesPending} arquivo(s) para restaurar setor/PJ/mapeamento.`
        : "Campos do formulário reaplicados.",
    });
  }, [hospital?.id, analysisMode, paymentModelId]);

  // ===== Autosave (debounced) =====
  useEffect(() => {
    if (!draftLoadedRef.current) return;
    if (draftClearedRef.current) return;
    if (!hospital?.id) return;
    draftDirtyRef.current = true;
    const t = setTimeout(() => {
      const fileDecisions: Record<string, FileDecision> = { ...pendingFileDecisionsRef.current };
      for (const b of buckets) {
        const k = fileKey(b.file);
        fileDecisions[k] = {
          sectorMapping: b.sectorMapping ?? null,
          matchedCompany: b.matchedCompany,
          manualOverride: b.manualOverride,
          convenioValueTotalized: b.convenioValueTotalized,
          headerRowIndex: b.headerRowIndex,
          sectorColumnUsed: b.sectorColumnUsed ?? null,
          columnOverrides: b.columnOverrides as Record<string, unknown> | undefined,
          columnMapping: b.columnMapping as Record<string, unknown> | undefined,
        };
      }
      saveDraft(hospital.id, analysisMode, paymentModelId, {
        form: {
          reference, description, competenceMonths, paymentDueDate,
          paymentKind: paymentKind || undefined,
          paymentTrack: paymentTrack || undefined,
          costCenterCode, pSectors, pSpecialties,
          autoSectors, autoSpecialties, autoPaymentKind,
          importMode,
        },
        suspiciousDecisions,
        fileDecisions,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [
    hospital?.id, analysisMode, paymentModelId,
    reference, description, competenceMonths, paymentDueDate,
    paymentKind, paymentTrack, costCenterCode, pSectors, pSpecialties,
    autoSectors, autoSpecialties, autoPaymentKind, importMode,
    suspiciousDecisions, buckets,
  ]);

  const discardDraft = useCallback(() => {
    if (!hospital?.id) return;
    clearDraft(hospital.id, analysisMode, paymentModelId);
    pendingFileDecisionsRef.current = {};
    setDraftRestoredAt(null);
    draftClearedRef.current = true;
    setTimeout(() => { draftClearedRef.current = false; }, 1500);
    toast({ title: "Rascunho descartado" });
  }, [hospital?.id, analysisMode, paymentModelId]);


  const suspiciousByBucket = useMemo(() => {
    return buckets.map((b) => {
      const totalRowsInSheet = b.rawMatrix
        ? Math.max(0, b.rawMatrix.length - ((b.headerRowIndex ?? 0) + 1))
        : b.rows.length;
      return detectSuspiciousRows(b.rows, { totalRowsInSheet });
    });
  }, [buckets]);

  const pendingSuspiciousCount = useMemo(() => {
    let c = 0;
    buckets.forEach((b, i) => {
      const list = suspiciousByBucket[i] ?? [];
      for (const r of list) {
        if (!suspiciousDecisions[decisionKey(b.file.name, r.rowNumber)]) c++;
      }
    });
    return c;
  }, [buckets, suspiciousByBucket, suspiciousDecisions]);

  // === Zeev — contexto de staging (pré-envio) ===
  const stagingContext = useMemo<StagingContext>(() => ({
    files: buckets.map((b, i) => ({ fileName: b.file.name, rows: suspiciousByBucket[i] ?? [] })),
    decisions: suspiciousDecisions as Record<string, StagingDecision>,
    applyDecisions: (changes) => {
      setSuspiciousDecisions((prev) => {
        const next = { ...prev };
        for (const c of changes) next[decisionKey(c.fileName, c.rowNumber)] = c.decision;
        return next;
      });
    },
    buckets: buckets.map((b, idx) => ({
      idx,
      fileName: b.file.name,
      matchScore: b.matchScore,
      manualOverride: !!b.manualOverride,
      sectorMissing: !!b.sectorMissing,
      sectorMapping: b.sectorMapping ?? null,
    })),
    setBucketSectors: (changes) => {
      if (changes.length === 0) return;
      const byIdx = new Map(changes.map((c) => [c.idx, c.sector]));
      setBuckets((prev) => prev.map((b, i) => {
        const s = byIdx.get(i);
        return s ? { ...b, sectorMapping: s } : b;
      }));
    },
  }), [buckets, suspiciousByBucket, suspiciousDecisions]);

  // === Zeev — insights automáticos de staging ===
  const zeevStagingInsights = useMemo<ZeevInsight[]>(() => {
    const out: ZeevInsight[] = [];
    if (buckets.length === 0) return out;

    // 1) Setor faltando — botões de aplicação direta por setor (sem digitar nada).
    const missingSector = buckets
      .map((b, idx) => ({ b, idx }))
      .filter(({ b }) => b.sectorMissing && !b.sectorMapping);
    if (missingSector.length > 0) {
      const names = missingSector.map(({ b }) => b.file.name);
      const preview = names.slice(0, 3).join(", ") + (names.length > 3 ? ` (+${names.length - 3})` : "");
      const applySector = (sector: RuleSector) => {
        const idxs = missingSector.map(({ idx }) => idx);
        setBuckets((prev) => prev.map((bk, i) => idxs.includes(i) ? { ...bk, sectorMapping: sector } : bk));
        toast({
          title: `Setor ${RULE_SECTOR_LABELS[sector]} aplicado`,
          description: `${idxs.length} ${idxs.length === 1 ? "arquivo" : "arquivos"} sem setor agora usam ${RULE_SECTOR_LABELS[sector]}.`,
        });
      };
      out.push({
        id: `staging-sector-missing-${missingSector.length}`,
        priority: missingSector.length >= 3 ? "alta" : "media",
        icon: AlertTriangle,
        title: `${missingSector.length} arquivo${missingSector.length === 1 ? "" : "s"} sem setor`,
        message: `Sem setor o motor não calcula. Escolha um setor abaixo pra aplicar de uma vez. Afetados: ${preview}.`,
        inlineActionsHint: `Aplicar em ${missingSector.length} ${missingSector.length === 1 ? "arquivo" : "arquivos"}:`,
        inlineActions: (Object.keys(RULE_SECTOR_LABELS) as RuleSector[]).map((s) => ({
          id: `apply-${s}`,
          label: RULE_SECTOR_LABELS[s],
          onClick: () => applySector(s),
          tone: "outline" as const,
        })),
      });
    }

    // 2) PJ não confirmada
    const noPj = buckets
      .map((b, idx) => ({ b, idx, count: b.rows.filter((r) => !b.manualOverride && !r.company_id).length }))
      .filter(({ count }) => count > 0);
    const noPjCount = noPj.reduce((sum, item) => sum + item.count, 0);
    if (noPjCount > 0) {
      const names = noPj.map(({ b }) => b.file.name).slice(0, 3).join(", ");
      out.push({
        id: `staging-pj-${noPjCount}`,
        priority: noPjCount >= 100 ? "alta" : "media",
        icon: Building2,
        title: `${noPjCount} item${noPjCount === 1 ? "" : "s"} sem PJ confirmada`,
        message: `Só os itens sem PJ ficam isolados no pagamento. Os itens já identificados serão divididos por empresa. Afetados: ${names}${noPj.length > 3 ? "…" : ""}.`,
      });
    }

    // 3) Linhas suspeitas pendentes — botões diretos (descartar / informativo / manter).
    if (pendingSuspiciousCount > 0) {
      const applyAll = (decision: "discard" | "informative_total" | "keep") => {
        const labelMap = { discard: "Descartadas", informative_total: "Marcadas como informativo", keep: "Mantidas como item" };
        setSuspiciousDecisions((prev) => {
          const next = { ...prev };
          buckets.forEach((b, i) => {
            const rows = suspiciousByBucket[i] ?? [];
            for (const r of rows) {
              const k = decisionKey(b.file.name, r.rowNumber);
              if (!next[k]) next[k] = decision;
            }
          });
          return next;
        });
        toast({
          title: `${labelMap[decision]}`,
          description: `${pendingSuspiciousCount} ${pendingSuspiciousCount === 1 ? "linha suspeita" : "linhas suspeitas"} processadas.`,
        });
      };
      out.push({
        id: `staging-suspicious-${pendingSuspiciousCount}`,
        priority: pendingSuspiciousCount >= 5 ? "alta" : "media",
        icon: AlertCircle,
        title: `${pendingSuspiciousCount} linha${pendingSuspiciousCount === 1 ? "" : "s"} suspeita${pendingSuspiciousCount === 1 ? "" : "s"} pendente${pendingSuspiciousCount === 1 ? "" : "s"}`,
        message: `Provavelmente totalizadores/rodapé. Posso aplicar a mesma decisão em todas de uma vez.`,
        inlineActionsHint: "Aplicar em todas:",
        inlineActions: [
          { id: "discard-all", label: "Descartar tudo", onClick: () => applyAll("discard"), tone: "primary" },
          { id: "informative-all", label: "Total informativo", onClick: () => applyAll("informative_total"), tone: "outline" },
          { id: "keep-all", label: "Manter como item", onClick: () => applyAll("keep"), tone: "outline" },
        ],
      });
    }

    // 4) Mapeamento incompleto
    // Importante: passar paymentModelMeta para summarizeMissing — sem isso,
    // procedure_code/doctor_role contam como faltando mesmo quando o tipo
    // injeta TUSS/função default (ex.: Consulta com TUSS 10101012, Clínico),
    // gerando alerta "X faltando" depois que o usuário já mapeou tudo no modal.
    const mappingProblems = buckets
      .map((b, idx) => {
        const hits = b.mappingHits ?? [];
        const summary = hits.length ? summarizeMissing(hits, paymentModelMeta, modoConfeccao ? "confeccao" : "analise") : { missingRequired: [], lowConfidence: [] };
        return { idx, name: b.file.name, missing: summary.missingRequired.length, low: summary.lowConfidence.length };
      })
      .filter((m) => m.missing > 0);
    if (mappingProblems.length > 0) {
      const first = mappingProblems[0];
      out.push({
        id: `staging-mapping-${mappingProblems.length}`,
        priority: "alta",
        icon: AlertTriangle,
        title: `${mappingProblems.length} arquivo${mappingProblems.length === 1 ? "" : "s"} com mapeamento incompleto`,
        message: `Sem mapear as colunas obrigatórias o lote não pode ser enviado. Comece por: ${first.name} (${first.missing} faltando).`,
        actionLabel: "Abrir mapeamento",
        onAction: () => setMappingDialog({ open: true, bucketIdx: first.idx }),
      });
    }

    return out;
  }, [buckets, pendingSuspiciousCount, paymentModelMeta, modoConfeccao]);

  const allRows = useMemo(() => {
    return buckets.flatMap((b, bucketIndex) =>
      b.rows
        .filter((r) => {
          const d = suspiciousDecisions[decisionKey(b.file.name, r.source_row_number)];
          return d !== "discard" && d !== "informative_total";
        })
        .map((r, rowIndex) => ({ ...r, source_bucket_index: bucketIndex, source_row_index: rowIndex }))
    ).map((r) => {
      const tipo_linha = r.tipo_linha_manual ?? classifyLine(r, paymentKind || null);
      const withType = { ...r, tipo_linha };
      return { ...withType, line_issues: validateLine(withType, { modoConfeccao }) };
    });
  }, [buckets, paymentKind, modoConfeccao, suspiciousDecisions]);
  const total = allRows.reduce(
    (s, r) => s + (modoConfeccao ? Number(r.procedure_amount ?? r.gross_amount ?? 0) : Number(r.gross_amount ?? 0)),
    0,
  );

  // === Confecção parecer: rowKey estável + cálculo de pendentes ===
  // rowKey == `${source_bucket_index}|${source_row_index}` é único por allRows
  // e sobrevive a re-renders enquanto buckets não mudarem.
  const getRowKey = (r: any) => `${r.source_bucket_index ?? 0}|${r.source_row_index ?? 0}`;
  const pendingSpecialtyRows = useMemo(() => {
    if (!requiresSpecialtyOnAllRows) return [];
    return allRows
      .filter((r) => !r.specialty && !specialtyOverrides[getRowKey(r)])
      .map((r) => ({
        rowKey: getRowKey(r),
        attendance_number: r.attendance_number ?? null,
        doctor_name: r.doctor_name ?? null,
        patient_name: r.patient_name ?? null,
        procedure_date: r.procedure_date ?? null,
      }));
  }, [allRows, requiresSpecialtyOnAllRows, specialtyOverrides]);


  // ===== Lookup estrito de cadastros (médicos / convênios / setores) =====
  const [doctorReg, setDoctorReg] = useState<DoctorRegistry | null>(null);
  const [convenioReg, setConvenioReg] = useState<ConvenioRegistry | null>(null);
  const [sectorReg, setSectorReg] = useState<SectorRegistry | null>(null);
  const [registryVersion, setRegistryVersion] = useState(0);

  const reloadRegistries = async (force = false) => {
    if (!force && registriesLoadPromiseRef.current) return registriesLoadPromiseRef.current;
    const activeHospitalId = hospital?.id ?? null;
    registriesLoadPromiseRef.current = (async () => {
      const [d, c, s] = await Promise.all([
        loadDoctorRegistry(force),
        loadConvenioRegistry(activeHospitalId, force),
        loadSectorRegistry(activeHospitalId, force),
      ]);
      setDoctorReg(d);
      setConvenioReg(c);
      setSectorReg(s);
      setRegistryVersion((v) => v + 1);
    })();
    try {
      await registriesLoadPromiseRef.current;
    } finally {
      registriesLoadPromiseRef.current = null;
    }
  };

  // Recarrega cadastros sempre que houver linhas E o hospital ativo mudar/carregar.
  // Bug anterior: se o `hospital` ainda estava carregando quando `allRows` chegava,
  // as registries eram buscadas com `hospital_id IS NULL`, deixando de fora os
  // aliases escopados ao hospital (ex.: "Codevasf - Casec" no Santa Helena) e
  // fazendo o alias já salvo reaparecer como "não resolvido".
  useEffect(() => {
    if (allRows.length === 0) return;
    // Força recarregar quando o hospital muda: cache é por hospitalId, então
    // não há custo desnecessário caso o hospital já esteja estável.
    reloadRegistries(true).catch((error) => {
      console.error("[NewPayment] reloadRegistries", error);
      toast({
        title: "Cadastros oficiais ainda não carregaram",
        description: "O upload pode continuar; se a lista de pendências não aparecer, aguarde alguns segundos e tente novamente.",
        variant: "destructive",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows.length, hospital?.id]);

  // Quando a linha já traz setor, ela é a fonte de verdade. O seletor do bucket
  // é apenas fallback para arquivo sem setor reconhecido — não pode transformar
  // linhas de Hemodinâmica em Centro Cirúrgico só porque esse foi o setor
  // dominante/selecionado no card do arquivo.
  const sectorForRow = (r: ParsedRow & { source_bucket_index?: number }): string | null => {
    // Tipos de pagamento por evento (parecer, visita...) não têm dimensão de setor.
    // Ignora qualquer valor capturado/override para não cair em Resolução de cadastros.
    if (paymentModelMeta?.default_function) return null;
    const bIdx = (r as any).source_bucket_index;
    const override = typeof bIdx === "number" ? buckets[bIdx]?.sectorMapping : null;
    const rowSector = r.sector?.trim();
    if (rowSector) return rowSector;
    if (override && override.trim()) return override;
    return null;
  };

  const resolvedRows = useMemo(() => {
    if (!doctorReg || !convenioReg || !sectorReg) {
      return allRows.map((r) => ({ ...r, _resolution: null as any }));
    }
    return allRows.map((r) => {
      const d = resolveDoctor({ name: r.doctor_name, crm: r.doctor_document, cpf: r.doctor_document }, doctorReg);
      const c = resolveConvenio(r.agreement_text, convenioReg);
      const s = resolveSector(sectorForRow(r), sectorReg);
      return {
        ...r,
        _resolution: {
          doctor_id: d.doctor?.id ?? null,
          doctor_matched_by: d.matched_by,
          convenio_slug: c.convenio?.slug ?? null,
          convenio_matched_by: c.matched_by,
          sector_slug: s.sector?.slug ?? null,
          sector_matched_by: s.matched_by,
        },
      };
    });
  }, [allRows, doctorReg, convenioReg, sectorReg, registryVersion, buckets]);

  // Agrupa não-resolvidos por (kind, texto bruto). Tipo_linha "patient_only"
  // (linhas sem médico no Excel) é ignorado para evitar falsos positivos.
  const unresolvedGroups = useMemo<UnresolvedGroup[]>(() => {
    if (!doctorReg || !convenioReg || !sectorReg) return [];
    const SAMPLE_LIMIT = 25;
    const map = new Map<string, UnresolvedGroup>();
    const bump = (kind: UnresolvedGroup["kind"], raw: string, r: any) => {
      const text = (raw ?? "").trim();
      if (!text) return;
      const key = `${kind}::${text.toLowerCase()}`;
      const sample = {
        attendance: r.attendance_number ?? null,
        patient: r.patient_name ?? null,
        doctor: r.doctor_name ?? null,
        date: r.procedure_date ?? null,
        procedure: r.procedure_name ?? r.procedure_code ?? null,
        source_file: r.source_file ?? null,
      };
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if ((existing.samples?.length ?? 0) < SAMPLE_LIMIT) existing.samples!.push(sample);
      } else {
        map.set(key, { kind, raw: text, count: 1, samples: [sample] });
      }
    };
    for (const r of resolvedRows) {
      const res = (r as any)._resolution;
      if (!res) continue;
      if (!res.doctor_id && r.doctor_name?.trim()) bump("doctor", r.doctor_name, r);
      if (!res.convenio_slug && r.agreement_text?.trim()) bump("convenio", r.agreement_text, r);
      const sectorRaw = sectorForRow(r as any);
      if (!res.sector_slug && sectorRaw?.trim()) bump("sector", sectorRaw, r);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [resolvedRows, doctorReg, convenioReg, sectorReg, buckets]);


  const registriesReady = allRows.length === 0 || (!!doctorReg && !!convenioReg && !!sectorReg);
  // Setor NÃO bloqueia envio: não é chave de cálculo (glosa/repasse/pool não usam
  // setor). Planilhas que historicamente não têm setor (ex.: Cardiologia Rateio,
  // Neurologia) não podem ser travadas por isso. Médico e convênio continuam
  // bloqueando porque o motor precisa deles para calcular.
  const blockingUnresolved = unresolvedGroups.filter((u) => u.kind !== "sector");
  const sectorOnlyUnresolvedCount = unresolvedGroups.length - blockingUnresolved.length;
  const hasUnresolved = blockingUnresolved.length > 0;


  const uniqueCompanyNames = useMemo(() => {
    // Em rateio: empresas vêm do pool (pool_participants), não da planilha.
    if (paymentMode === "rateio") return poolCompanyNames;
    const set = new Set<string>();
    for (const r of allRows) {
      const n = (r.company_name ?? "").trim();
      if (n) set.add(n);
    }
    return Array.from(set);
  }, [allRows, paymentMode, poolCompanyNames]);



  // Resumo da pré-validação
  const preValidation = useMemo(() => {
    const byType: Record<string, number> = {};
    let critical = 0;
    let warnings = 0;
    for (const r of allRows) {
      byType[r.tipo_linha] = (byType[r.tipo_linha] ?? 0) + 1;
      for (const i of r.line_issues) {
        if (i.severity === "critico") critical++;
        else warnings++;
      }
    }
    return { byType, critical, warnings };
  }, [allRows]);

  const rowsWithIssues = useMemo(
    () => allRows.filter((r) => r.line_issues.length > 0),
    [allRows],
  );

  // === Detecção heurística do conteúdo da planilha ===
  const detected = useMemo(() => {
    const text = (s: string | null | undefined) => (s ?? "").toLowerCase();
    const sectorHits: Record<string, number> = {};
    for (const r of allRows) {
      const blob = `${text(r.procedure_name)} ${text(r.description)} ${text(r.doctor_role)} ${text(r.sector)}`;
      if (/visita/.test(blob)) sectorHits.visita = (sectorHits.visita ?? 0) + 1;
      if (/parecer/.test(blob)) sectorHits.parecer = (sectorHits.parecer ?? 0) + 1;
      if (/cirurgia|cirurg/.test(blob)) sectorHits.cirurgia = (sectorHits.cirurgia ?? 0) + 1;
      if (/hemodin/.test(blob)) sectorHits.hemodinamica = (sectorHits.hemodinamica ?? 0) + 1;
      if (/consulta/.test(blob)) sectorHits.consulta = (sectorHits.consulta ?? 0) + 1;
      if (/procedimento/.test(blob) && !/cirurg/.test(blob)) sectorHits.procedimento = (sectorHits.procedimento ?? 0) + 1;
    }
    const detectedSectors = Object.keys(sectorHits).filter((k) => sectorHits[k] >= Math.max(1, allRows.length * 0.05));
    return { sectorHits, detectedSectors };
  }, [allRows]);

  // Alerta de conflito: usuário marcou setor que não aparece na base, ou não marcou setor presente
  const sectorConflicts = useMemo(() => {
    if (autoSectors || allRows.length === 0 || pSectors.length === 0) return [] as string[];
    const issues: string[] = [];
    for (const s of pSectors) {
      if (!detected.detectedSectors.includes(s)) {
        issues.push(`Você marcou "${RULE_SECTOR_LABELS[s as RuleSector] ?? s}" mas a base não contém itens compatíveis.`);
      }
    }
    for (const s of detected.detectedSectors) {
      if (!pSectors.includes(s) && (RULE_SECTOR_LABELS as any)[s]) {
        issues.push(`A base contém "${RULE_SECTOR_LABELS[s as RuleSector]}" mas você não marcou esse setor.`);
      }
    }
    return issues;
  }, [autoSectors, pSectors, detected, allRows.length]);

  // === Detecção automática da Categoria (atual / pendência / misto) ===
  // Compara as datas de procedimento da base com os meses de competência selecionados.
  const detectedKind = useMemo(() => {
    if (allRows.length === 0 || competenceMonths.length === 0) {
      return { kind: null as PaymentKind | null, current: 0, past: 0, dated: 0 };
    }
    const months = new Set(competenceMonths); // "YYYY-MM"
    const minMonth = [...competenceMonths].sort()[0];
    let current = 0;
    let past = 0;
    let dated = 0;
    for (const r of allRows) {
      if (!r.procedure_date) continue;
      const ym = r.procedure_date.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(ym)) continue;
      dated++;
      if (months.has(ym)) current++;
      else if (ym < minMonth) past++;
    }
    if (dated === 0) return { kind: null, current, past, dated };
    const ratioCurrent = current / dated;
    const ratioPast = past / dated;
    let kind: PaymentKind | null = null;
    if (ratioCurrent >= 0.95) kind = "atual";
    else if (ratioPast >= 0.95) kind = "pendencia";
    else if (current > 0 && past > 0) kind = "misto";
    return { kind, current, past, dated };
  }, [allRows, competenceMonths]);

  // Aplica a categoria detectada quando o modo automático está ativo.
  useEffect(() => {
    if (!autoPaymentKind) return;
    if (detectedKind.kind && detectedKind.kind !== paymentKind) {
      setPaymentKind(detectedKind.kind);
    }
  }, [autoPaymentKind, detectedKind.kind, paymentKind]);

  const submit = async () => {
    if (!reference.trim()) {
      toast({ title: "Informe a referência do lote", variant: "destructive" }); return;
    }
    // Detecta intenção: se o nome do lote sugere confecção mas o modo está em
    // padrão, confirma antes de submeter. Evita criar lote que vai gerar
    // dezenas de reprovados quando o analista queria que o sistema calculasse.
    if (analysisMode === "padrao" && /confec[çc]/i.test(reference)) {
      const ok = window.confirm(
        `A referência menciona "confecção" mas o Modo de análise está em PADRÃO.\n\n` +
        `• Padrão: o sistema VERIFICA o repasse que você já calculou (gera alertas/reprovados quando há divergência).\n` +
        `• Confecção: o sistema CALCULA o repasse pelas regras cadastradas (não há divergência a apontar).\n\n` +
        `Deseja continuar mesmo assim em modo Padrão?`
      );
      if (!ok) return;
    }
    if (requiresParecerReport && !parecerPayload) {
      toast({
        title: "Anexe o relatório de pareceres",
        description: requiresSpecialtyOnAllRows
          ? "Em confecção de Parecer, o relatório do Tasy é obrigatório para cruzar com a base e classificar cada item."
          : "Lote misto: anexe o relatório do Tasy para cruzar os atendimentos de parecer/visita.",
        variant: "destructive",
      });
      return;
    }
    if (mixedParecer.enabled && !mixedParecer.item_type_id) {
      toast({
        title: "Selecione o subtipo de parecer",
        description: "No lote misto, escolha qual subtipo de parecer aplicar aos itens cruzados.",
        variant: "destructive",
      });
      return;
    }
    if (requiresSpecialtyOnAllRows && pendingSpecialtyRows.length > 0) {
      toast({
        title: `Especialidade obrigatória em ${pendingSpecialtyRows.length} item(ns)`,
        description: "Em confecção de Parecer a especialidade decide Parecer vs Visita. Preencha antes de criar o lote.",
        variant: "destructive",
      });
      setSpecialtyModalOpen(true);
      return;
    }


    if (competenceMonths.length === 0) {
      toast({ title: "Selecione ao menos um mês de competência", variant: "destructive" }); return;
    }
    if (!autoPaymentKind && !paymentKind) {
      toast({ title: "Selecione a categoria do pagamento", variant: "destructive" }); return;
    }
    if (!paymentType) {
      toast({ title: "Selecione o tipo de pagamento", description: "Esse campo é obrigatório para evitar comparações entre lotes de tipos diferentes.", variant: "destructive" }); return;
    }
    if (allRows.length === 0) {
      toast({ title: "Carregue pelo menos um arquivo válido", variant: "destructive" }); return;
    }
    // Itens sem identificação confiável de PJ viram órfãos em payment_unmatched_items.
    // Importante: em bases completas, o arquivo pode não representar uma PJ única;
    // então a decisão é por LINHA. Se a coluna EMPRESA/PJ resolveu uma empresa,
    // o item entra no motor mesmo que o nome do arquivo não seja uma PJ.
    const isBucketFileUnmatched = (b: FileBucket) =>
      !b.manualOverride && (!b.matchedCompany || b.matchScore < MATCH_AUTO_THRESHOLD);
    const isUnmatchedBucket = (b: FileBucket) =>
      isBucketFileUnmatched(b) && !b.rows.some((r) => !!r.company_id);
    const rowWillBeUnmatched = (r: ParsedRow, b: FileBucket | undefined) =>
      !b || (!b.manualOverride && !r.company_id);
    const unmatchedRowsPreview = allRows.filter((r) => {
      const bIdx = (r as any).source_bucket_index as number | undefined;
      return rowWillBeUnmatched(r, typeof bIdx === "number" ? buckets[bIdx] : undefined);
    });
    if (unmatchedRowsPreview.length > 0) {
      const ok = confirm(
        `${unmatchedRowsPreview.length} item(ns) sem PJ identificada com confiança suficiente.\n\n` +
        `Esses itens ficarão isolados em "Empresas não vinculadas" e NÃO entrarão na análise. ` +
        `Os demais itens já identificados serão divididos por empresa normalmente.\n\nProsseguir mesmo assim?`,
      );
      if (!ok) return;
    }

    if (preValidation.critical > 0) {
      toast({
        title: `Pré-validação: ${preValidation.critical} erro(s) crítico(s)`,
        description: "Corrija a planilha antes de enviar (campos obrigatórios ausentes por tipo de linha).",
        variant: "destructive",
      });
      return;
    }
    if (preValidation.warnings > 0) {
      const ok = confirm(`A base contém ${preValidation.warnings} alerta(s) leve(s) (ex.: complemento sem atendimento, tipo não identificado). Deseja prosseguir?`);
      if (!ok) return;
    }
    // Em modo CONFECÇÃO o setor é obrigatório em TODO bucket matched (afeta cálculo de regras).
    // Em modo análise basta bloquear quando o detector não conseguiu inferir.
    const unmappedSectorBuckets = modoConfeccao
      ? buckets.filter((b) => !isUnmatchedBucket(b) && !b.sectorMapping && (b.sectorMissing || !b.sectorColumnUsed))
      : buckets.filter((b) => b.sectorMissing && !b.sectorMapping);
    if (unmappedSectorBuckets.length > 0) {
      toast({
        title: modoConfeccao ? "Setor obrigatório em confecção" : "Setor não identificado",
        description: `Selecione o setor (botão "Setor: …" no topo de cada arquivo) em: ${unmappedSectorBuckets.map((b) => b.file.name).join(", ")}.`,
        variant: "destructive",
      });
      return;
    }
    if (sectorConflicts.length > 0) {
      const ok = confirm(`Conflito detectado entre seleção manual e a base:\n\n${sectorConflicts.join("\n")}\n\nDeseja prosseguir mesmo assim?`);
      if (!ok) return;
    }
    if (isHistoricoImport) {
      if (!canImportHistorico) {
        toast({ title: "Sem permissão para importação histórica", variant: "destructive" });
        return;
      }
      if (competenceOutOfWindow || competenceMonths.length === 0) {
        toast({
          title: "Competência fora da janela histórica",
          description: `A importação histórica só aceita competências entre ${HISTORICO_WINDOW.start} e ${HISTORICO_WINDOW.end}.`,
          variant: "destructive",
        });
        return;
      }
      const ok = await confirmDialog({
        title: "Marcar lote como HISTÓRICO",
        description: "Esta importação será gravada diretamente como paga e não passará pelo fluxo de validação.",
        details:
          "• O motor vai rodar (regras, repasses, aliases, KPIs).\n" +
          "• NÃO passará por validação, aprovação ou NF.\n" +
          "• Será gravado direto com status PAGO.",
        confirmText: "Sim, gravar como histórico",
        cancelText: "Cancelar",
        tone: "warning",
      });
      if (!ok) return;
    }
    // === Validação: competência travada por run aprovado/válido no pool ===
    if (poolId) {
      const compIso = [...competenceMonths].sort().map((m) => `${m}-01`);
      if (compIso.length) {
        const { data: lockedRuns } = await supabase
          .from("pool_calculation_runs")
          .select("id, competence_month, invalidated_at")
          .eq("pool_id", poolId)
          .in("competence_month", compIso)
          .is("invalidated_at", null);
        if (lockedRuns && lockedRuns.length > 0) {
          const months = Array.from(new Set(lockedRuns.map((r: any) => String(r.competence_month).slice(0, 7)))).join(", ");
          toast({
            title: "Competência bloqueada no pool",
            description: `Há run válido no pool para ${months}. Invalide o run primeiro em /pools/relatorios antes de criar novo pagamento.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    // === Aviso: plantão variável sem valor cadastrado para a competência ===
    if (isPlantaoType && poolId && poolDeductionId) {
      const ded = poolDeductionsList.find((d) => d.id === poolDeductionId);
      if (ded?.valor_variavel) {
        const compIso = [...competenceMonths].sort().map((m) => `${m}-01`);
        const { data: existing } = await supabase
          .from("pool_deduction_values")
          .select("competence_month, valor")
          .eq("pool_deduction_id", poolDeductionId)
          .in("competence_month", compIso);
        const cadastradas = new Set((existing ?? []).map((v: any) => String(v.competence_month).slice(0, 10)));
        const faltando = compIso.filter((c) => !cadastradas.has(c));
        if (faltando.length) {
          toast({
            title: "Atenção: valor variável ainda não cadastrado",
            description: `O pagamento será gravado, mas a escala/valor para ${faltando.map((c) => c.slice(0, 7)).join(", ")} ainda não foi anexada em /pools/${poolId}/valores-mensais.`,
          });
        }
      }
    }

    setSubmitting(true);

    // Upload de TODOS os arquivos originais (auditoria).
    // Falha aqui = bloqueia o submit — não gravamos o lote sem os arquivos.
    type UploadedFile = {
      storage_path: string;
      original_filename: string;
      mime_type: string | null;
      size_bytes: number;
      sha256: string;
      bucket_role: ReturnType<typeof inferBucketRole>;
    };
    const uploadedFiles: UploadedFile[] = [];
    const uploadFailures: { name: string; message: string }[] = [];
    const safeStorageExtension = (name: string) => {
      const match = name.match(/\.([A-Za-z0-9]{1,12})$/);
      return match ? `.${match[1].toLowerCase()}` : "";
    };
    // Sanitização defensiva: Supabase Storage rejeita chaves com espaços, acentos
    // ou caracteres Unicode ("Invalid key"). Nome original fica em original_filename;
    // a chave é sempre opaca e ASCII.
    const asciiOnly = (s: string) => {
      try {
        return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]/g, "_");
      } catch {
        return s.replace(/[^A-Za-z0-9._-]/g, "_");
      }
    };
    const buildSafePath = (file: File) => {
      const uniqueId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ext = asciiOnly(safeStorageExtension(file.name));
      let path = `${user!.id}/${Date.now()}-${uniqueId}${ext}`;
      if (/[^\x20-\x7E]/.test(path) || /\s/.test(path)) {
        path = asciiOnly(path);
      }
      return path;
    };
    for (const b of buckets) {
      try {
        const path = buildSafePath(b.file);
        const hash = await sha256Hex(b.file);
        const { error: upErr } = await supabase.storage
          .from("payment-files")
          .upload(path, b.file, { upsert: false, contentType: b.file.type || undefined });
        if (upErr) throw new Error(upErr.message);
        uploadedFiles.push({
          storage_path: path,
          original_filename: b.file.name,
          mime_type: b.file.type || null,
          size_bytes: b.file.size,
          sha256: hash,
          bucket_role: inferBucketRole(b.file.name),
        });
      } catch (uploadErr) {
        // NÃO bloqueia a criação do lote — auditoria de arquivo é secundária.
        const message = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        console.warn(`[NewPayment] Falha ao salvar arquivo original "${b.file.name}":`, message);
        uploadFailures.push({ name: b.file.name, message });
      }
    }
    if (uploadFailures.length > 0) {
      toast({
        title: "Alguns arquivos originais não foram salvos para auditoria",
        description: `O lote será criado normalmente. ${uploadFailures.length} arquivo(s) sem cópia: ${uploadFailures.map((f) => f.name).join(", ")}`,
      });
    }
    const uploadedPaths = uploadedFiles.map((f) => f.storage_path);

    // Garante que o "hospital ativo" no servidor bate com o selecionado na UI
    // ANTES de inserir. Cobre o caso em que a sincronização inicial falhou ou
    // o usuário trocou de hospital em outra aba/dispositivo — a RLS
    // `active_hospital_scope` compara com current_active_hospital() no banco.
    if (hospital?.id) {
      const { error: syncErr } = await supabase.rpc("set_active_hospital", {
        p_hospital_id: hospital.id,
      });
      if (syncErr) {
        toast({
          title: "Não foi possível confirmar o hospital ativo",
          description: syncErr.message,
          variant: "destructive",
        });
        return;
      }
    }


    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        reference: reference.trim(),
        description: description.trim() || null,
        // Em CONFECÇÃO, payments.status fica em 'rascunho' (placeholder);
        // o status operacional vive em confeccao_status. Em ANÁLISE,
        // o motor é disparado imediatamente (em_analise_ia).
        // Em HISTÓRICO, também entra em em_analise_ia para o motor rodar;
        // ao final, será marcado como 'pago' pelo próprio motor.
        status: (analysisMode === "confeccao" ? "rascunho" : "em_analise_ia") as any,
        confeccao_status: (analysisMode === "confeccao" ? "em_confeccao" : null) as any,
        total_amount: total,
        items_count: allRows.length,
        source_file_path: uploadedPaths[0] ?? null,
        created_by: user!.id,
        hospital_id: hospital?.id ?? null,
        competence_month: `${[...competenceMonths].sort()[0]}-01`,
        competence_months: [...competenceMonths].sort().map((m) => `${m}-01`),
        payment_due_date: paymentDueDate || null,
        payment_type: paymentType as PaymentType,
        payment_kind: (paymentKind || null) as PaymentKind | null,
        payment_track: (paymentTrack || null) as PaymentTrack | null,
        cost_center_code: costCenterCode,
        sectors: autoSectors ? [] : pSectors,
        specialties: autoSpecialties ? [] : pSpecialties,
        analysis_mode: analysisMode,
        payment_model_id: paymentModelMeta?.id ?? paymentModelId,
        has_mixed_parecer: mixedParecer.enabled,
        mixed_parecer_item_type_id: mixedParecer.enabled ? mixedParecer.item_type_id : null,
        import_mode: isHistoricoImport ? "historico" : "normal",
        payment_mode: paymentMode,
        competence_regime: competenceRegime,
        pool_id: poolId || null,
        pool_deduction_id: (isPlantaoType && poolDeductionId) ? poolDeductionId : null,
        rateio_source: paymentMode === "rateio" ? rateioSource : null,
        rateio_valor_total: paymentMode === "rateio" && rateioSource === "sintetico" && rateioValorTotal
          ? Number(rateioValorTotal)
          : null,
      } as any)
      .select()
      .single();


    if (error || !payment) {
      setSubmitting(false);
      toast({ title: "Erro ao criar pagamento", description: error?.message, variant: "destructive" });
      return;
    }

    // Registra planilhas originais para auditoria (payment_source_files).
    // Falha aqui é tolerada — o pagamento já foi criado; log e segue.
    if (uploadedFiles.length > 0) {
      const sourceRows = uploadedFiles.map((f) => ({
        payment_id: payment.id,
        storage_bucket: "payment-files",
        storage_path: f.storage_path,
        original_filename: f.original_filename,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
        sha256: f.sha256,
        bucket_role: f.bucket_role,
        uploaded_by: user!.id,
      }));
      const { error: psfErr } = await (supabase as any)
        .from("payment_source_files")
        .insert(sourceRows);
      if (psfErr) {
        console.warn("[NewPayment] payment_source_files insert falhou:", psfErr);
      }
    }


    const rollbackCreatedPayment = async (context: string) => {
      const { error: rollbackErr } = await (supabase as any).rpc("rollback_new_payment", {
        _payment_id: payment.id,
      });
      if (rollbackErr) {
        console.warn(`[NewPayment] rollback falhou (${context}):`, rollbackErr);
      }
      return rollbackErr;
    };

    // Vincula o payment criado de volta na apuração retroativa (handoff).
    if (retroHandoff?.reconciliation_id) {
      try {
        const { data: rec } = await supabase
          .from("retroactive_reconciliations" as never)
          .select("summary")
          .eq("id", retroHandoff.reconciliation_id)
          .single();
        const prevSummary = (rec as { summary?: Record<string, unknown> } | null)?.summary ?? {};
        const prevHandoff = (prevSummary as { handoff?: Record<string, unknown> }).handoff ?? {};
        await supabase
          .from("retroactive_reconciliations" as never)
          .update({
            summary: {
              ...prevSummary,
              handoff: {
                ...prevHandoff,
                status: "encaminhada",
                payment_id: payment.id,
                payment_reference: reference.trim(),
                linked_at: new Date().toISOString(),
              },
            },
          } as never)
          .eq("id", retroHandoff.reconciliation_id);
        
      } catch { /* não bloqueia criação do payment */ }
    }


    const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
    // Fallback de especialidade: para itens sem coluna 'Especialidade' no Excel,
    // tentamos resolver pelo cadastro do médico (CRM ou nome).
    const missingSpecCRMs = Array.from(new Set(
      allRows.filter((r) => !r.specialty).map((r) => onlyDigits(r.doctor_document)).filter(Boolean),
    ));
    const missingSpecNames = Array.from(new Set(
      allRows.filter((r) => !r.specialty && !onlyDigits(r.doctor_document)).map((r) => r.doctor_name).filter(Boolean),
    ));
    const doctorSpecByCRM: Record<string, string> = {};
    const doctorSpecByName: Record<string, string> = {};
    if (missingSpecCRMs.length > 0 || missingSpecNames.length > 0) {
      const { data: docs } = await supabase
        .from("doctors")
        .select("crm,full_name,specialties")
        .or([
          missingSpecCRMs.length ? `crm.in.(${missingSpecCRMs.map((c) => `"${c}"`).join(",")})` : "",
          missingSpecNames.length ? `full_name.in.(${missingSpecNames.map((n) => `"${n.replace(/"/g, "")}"`).join(",")})` : "",
        ].filter(Boolean).join(","));
      for (const d of docs ?? []) {
        const sp = Array.isArray((d as any).specialties) && (d as any).specialties.length > 0 ? (d as any).specialties[0] : null;
        if (!sp) continue;
        const crm = onlyDigits((d as any).crm);
        if (crm) doctorSpecByCRM[crm] = sp;
        if ((d as any).full_name) doctorSpecByName[(d as any).full_name] = sp;
      }
    }
    const resolveSpecialty = (r: ParsedRow): string | null => {
      if (r.specialty) return r.specialty;
      const ov = specialtyOverrides[getRowKey(r as any)];
      if (ov) return ov;
      const crm = onlyDigits(r.doctor_document);
      if (crm && doctorSpecByCRM[crm]) return doctorSpecByCRM[crm];
      if (r.doctor_name && doctorSpecByName[r.doctor_name]) return doctorSpecByName[r.doctor_name];
      return null;
    };


    // Normaliza o setor lido (ou herdado do bucket) para o slug canônico via
    // tabela `sectors` + aliases. Garante que "Hemodinâmica (DFStar)" e variações
    // virem `hemodinamica` no banco, formato esperado pelo motor de regras.
    const sectorAliases = await loadSectorAliases(hospital?.id ?? null);
    const normalizeSector = (raw: string | null | undefined): string | null => {
      if (!raw) return null;
      const slug = sectorAliases.resolveSlug(raw);
      return slug ?? (String(raw).trim().toLowerCase() || null);
    };

    // Pré-carrega o default da empresa (item_type) de cada empresa vinculada ao lote.
    // Permite, p.ex., uma PJ marcada como "sempre Visita" entrar pré-classificada
    // mesmo num lote criado como Parecer Adulto — sem o analista reclassificar
    // toda vez. NÃO usa allow_mixed_subtypes como gate: se a empresa tem default,
    // respeita.
    // D3.e.4: coluna canônica única `default_item_type_id` (legada removida).
    const companyDefaultTypeMap = new Map<string, string | null>();
    {
      const ids = new Set<string>();
      for (const b of (buckets ?? [])) {
        const cid = b.matchedCompany?.id;
        if (cid) ids.add(cid);
      }
      for (const r of allRows) {
        if (r.company_id) ids.add(r.company_id);
      }
      if (ids.size > 0) {
        const { data } = await supabase
          .from("companies")
          .select("id, default_item_type_id")
          .in("id", Array.from(ids));
        for (const c of ((data ?? []) as any[])) {
          companyDefaultTypeMap.set(c.id, c.default_item_type_id ?? null);
        }
      }
    }


    // Constrói uma linha de payment_items para uma row "matched"
    const buildItemRow = (r: ParsedRow, currentBucket: FileBucket | undefined) => {
      const dRes = doctorReg ? resolveDoctor({ name: r.doctor_name, crm: r.doctor_document, cpf: r.doctor_document }, doctorReg) : { doctor: null, matched_by: null as any };
      const cRes = convenioReg ? resolveConvenio(r.agreement_text, convenioReg) : { convenio: null, matched_by: null as any };
      // Setor da linha vence; bucket.sectorMapping é fallback apenas quando a
      // planilha não trouxe setor para aquela linha.
      const rowSectorRaw = r.sector?.trim() || null;
      const fallbackSector = currentBucket?.sectorMapping?.trim() || null;
      const sRawForLookup = rowSectorRaw || fallbackSector;
      const sRes = sectorReg ? resolveSector(sRawForLookup, sectorReg) : { sector: null, matched_by: null as any };


      return ({
        hospital_id: (payment as any).hospital_id ?? hospital?.id,
        payment_id: payment.id,
        source_file_name: currentBucket?.file?.name ?? (r as any).source_file ?? null,
        doctor_name: r.doctor_name,
        doctor_document: r.doctor_document,
        doctor_email: r.doctor_email,
        description: r.description,
        // [Confecção] motor é dono do gross_amount; planilha só traz procedure_amount.
        // Em análise, gross_amount = valor pago da base. Em confecção, fica NULL até o motor calcular.
        gross_amount: modoConfeccao ? null : r.gross_amount,
        company_name: currentBucket?.manualOverride ? (currentBucket?.matchedCompany?.name || r.company_name) : r.company_name,
        company_id: currentBucket?.manualOverride ? (currentBucket?.matchedCompany?.id || r.company_id) : r.company_id,
        attendance_number: r.attendance_number,
        procedure_code: r.procedure_code,
        procedure_name: r.procedure_name,
        access_route: r.access_route,
        doctor_role: r.doctor_role,
        agreement_text: r.agreement_text,
        specialty: resolveSpecialty(r),
        procedure_amount: r.procedure_amount,
        quantity: r.quantity,
        procedure_date: r.procedure_date,
        procedure_date_has_time: r.procedure_date_has_time,
        patient_name: r.patient_name,
        sector: applySectorStems(sRawForLookup) ?? sRes.sector?.slug ?? normalizeSector(sRawForLookup),
        attendance_character: r.attendance_character,
        raw_data: r.raw_data as never,
        tipo_linha: r.tipo_linha,
        convenio_value_totalized: currentBucket?.convenioValueTotalized || false,
        // === Vínculos estritos com cadastros (lookup obrigatório) ===
        doctor_id: dRes.doctor?.id ?? null,
        doctor_matched_by: dRes.matched_by,
        convenio_slug: cRes.convenio?.slug ?? null,
        convenio_matched_by: cRes.matched_by,
        sector_slug: sRes.sector?.slug ?? null,
        sector_matched_by: sRes.matched_by,
      // Herda o tipo de pagamento na seguinte ordem de precedência:
        //   1) override por linha do parser (subtype_split_hint) — fonte 'base'
        //   2) default da empresa (companies.default_item_type_id) — fonte 'company_override'
        //   3) tipo do lote (payment.payment_model_id) — fonte 'default'
        // Motor usa este campo para filtrar regras com item_type_id setado.
        ...(() => {
          const cid = (currentBucket?.manualOverride
            ? currentBucket?.matchedCompany?.id
            : r.company_id) ?? currentBucket?.matchedCompany?.id ?? null;
          const companyDefault = cid ? companyDefaultTypeMap.get(cid) ?? null : null;
          const loteId = paymentModelMeta?.item_type_id ?? null;
          if (r.payment_type_id_override) {
            return { item_type_id: r.payment_type_id_override, item_type_source: "auto_heuristic" };
          }
          if (companyDefault && companyDefault !== loteId) {
            return { item_type_id: companyDefault, item_type_source: "inherit" };
          }
          return { item_type_id: loteId, item_type_source: loteId ? "inherit" : null };
        })(),
      });
    };


    // Constrói uma linha de payment_unmatched_items (quarentena — não entra no motor)
    const buildUnmatchedRow = (r: ParsedRow, b: FileBucket) => ({
      payment_id: payment.id,
      source_file: b.file.name,
      source_file_name: b.file.name,
      raw_company_name: (r.company_name || b.rawCompanyName || "—").trim(),
      match_score: b.matchScore || 0,
      match_suggestion_id: b.matchedCompany?.id ?? null,
      match_suggestion_name: b.matchedCompany?.name ?? null,
      hospital_id: hospital?.id,
      doctor_name: r.doctor_name,
      doctor_document: r.doctor_document,
      doctor_email: r.doctor_email,
      description: r.description,
      gross_amount: modoConfeccao ? 0 : (r.gross_amount ?? 0),

      attendance_number: r.attendance_number,
      procedure_code: r.procedure_code,
      procedure_name: r.procedure_name,
      access_route: r.access_route,
      doctor_role: r.doctor_role,
      agreement_text: r.agreement_text,
      specialty: resolveSpecialty(r),
      procedure_amount: r.procedure_amount,
      quantity: r.quantity,
      procedure_date: r.procedure_date,
      procedure_date_has_time: r.procedure_date_has_time,
      patient_name: r.patient_name,
      sector: normalizeSector((r.sector?.trim() || b.sectorMapping?.trim()) || null),
      attendance_character: r.attendance_character,
      raw_data: r.raw_data as never,
      tipo_linha: r.tipo_linha,
      convenio_value_totalized: b.convenioValueTotalized || false,
    });

    const matchedItems: ReturnType<typeof buildItemRow>[] = [];
    const unmatchedItems: ReturnType<typeof buildUnmatchedRow>[] = [];
    // Snapshot dos valores BRUTOS (pré-normalização) alinhado 1:1 com matchedItems.
    // Necessário para o auto-aprendizado de aliases: `it.sector` guarda o SLUG já
    // canonicalizado (bug histórico), então `sector_raw: it.sector` no learn nunca
    // diferia do canônico e nenhum alias de setor era criado. Também mantemos aqui
    // doctor_name/agreement_text para blindar contra futuras normalizações in-place.
    // Sintoma observado: Santa Luzia/Helena com 0-1 aliases auto após várias semanas.
    const matchedRawForLearn: Array<{
      doctor_name: string | null;
      agreement_text: string | null;
      sector_raw: string | null;
    }> = [];
    // Itera direto sobre allRows usando source_bucket_index — evita drift de offset
    // quando suspiciousDecisions filtram linhas (causa raiz de lotes presos em
    // em_analise_ia: buildItemRow recebia undefined e o try/catch externo
    // marcava o payment sem inserir itens).
    const orphanRows: number[] = [];
    for (let idx = 0; idx < allRows.length; idx++) {
      const r = allRows[idx];
      if (!r) { orphanRows.push(idx); continue; }
      const bIdx = (r as any).source_bucket_index as number | undefined;
      const b = typeof bIdx === "number" ? buckets[bIdx] : undefined;
      if (!b) { orphanRows.push(idx); continue; }
      const isUnmatched = rowWillBeUnmatched(r, b);
      if (isUnmatched) unmatchedItems.push(buildUnmatchedRow(r, b));
      else {
        matchedItems.push(buildItemRow(r, b));
        // Mesmo cálculo de sRawForLookup usado em buildItemRow, preservado ANTES
        // da normalização para slug — o alias precisa do texto original do arquivo.
        const rowSectorRaw = r.sector?.trim() || null;
        const fallbackSector = b?.sectorMapping?.trim() || null;
        matchedRawForLearn.push({
          doctor_name: r.doctor_name ?? null,
          agreement_text: r.agreement_text ?? null,
          sector_raw: rowSectorRaw || fallbackSector,
        });
      }
    }
    if (orphanRows.length > 0) {
      setSubmitting(false);
      // Abort antes do insert para não deixar payment órfão em em_analise_ia.
      // Deleta o registro recém-criado para o analista poder reimportar limpo.
      await rollbackCreatedPayment("linha sem bucket");
      toast({
        title: "Inconsistência ao montar itens do lote",
        description: `${orphanRows.length} linha(s) sem bucket associado. Recarregue a página e tente novamente. Nenhum dado foi salvo.`,
        variant: "destructive",
      });
      return;
    }
    const expectedTotal = matchedItems.length + unmatchedItems.length;
    if (expectedTotal !== allRows.length) {
      setSubmitting(false);
      await rollbackCreatedPayment("contagem divergente");
      toast({
        title: "Inconsistência ao montar itens do lote",
        description: `Esperado ${allRows.length} itens, montados ${expectedTotal}. Recarregue a página e tente novamente.`,
        variant: "destructive",
      });
      return;
    }

    if (matchedItems.length > 0) {
      // Insert em lotes via RPC. bulk_insert_new_payment_items usa
      // statement_timeout=0 no banco, mas ainda assim lotes muito grandes
      // podem estourar o timeout curto da API (Postgrest ~8s por request)
      // quando há muitos itens por linha (triggers pesadas de rateio,
      // company_group, doctor_companies etc).
      //
      // Estratégia: começa com CHUNK moderado; em caso de statement/timeout,
      // quebra o slice em pedaços cada vez menores e re-tenta. Só faz rollback
      // se ficar impossível abaixo do menor tamanho.
      const CHUNK_START = 100;
      const MIN_CHUNK = 10;
      const TOTAL_LOTS = Math.ceil(matchedItems.length / CHUNK_START);

      const isTimeoutErr = (msg: string) =>
        /statement timeout|canceling statement due to statement timeout|57014|timeout/i.test(msg || "");

      const insertSlice = async (slice: any[], depth = 0): Promise<{ ok: true } | { ok: false; err: any }> => {
        const { error } = await (supabase as any).rpc("bulk_insert_new_payment_items", {
          _payment_id: payment.id,
          _items: slice,
        });
        if (!error) return { ok: true };
        // Só retenta em timeout; erros de schema/RLS devem falhar rápido.
        if (!isTimeoutErr(error.message) || slice.length <= MIN_CHUNK) {
          return { ok: false, err: error };
        }
        // Quebra ao meio e re-tenta cada metade.
        const half = Math.max(MIN_CHUNK, Math.floor(slice.length / 2));
        for (let j = 0; j < slice.length; j += half) {
          const sub = slice.slice(j, j + half);
          const res = await insertSlice(sub, depth + 1);
          if (!res.ok) return res;
        }
        return { ok: true };
      };

      for (let i = 0; i < matchedItems.length; i += CHUNK_START) {
        const slice = matchedItems.slice(i, i + CHUNK_START);
        const res = await insertSlice(slice);
        if (!res.ok) {
          await rollbackCreatedPayment("falha ao inserir payment_items");
          setSubmitting(false);
          toast({
            title: "Erro ao salvar itens",
            description: `${(res as any).err?.message ?? "erro desconhecido"} (lote ${Math.floor(i / CHUNK_START) + 1} de ${TOTAL_LOTS}). Nenhum dado foi salvo — seu rascunho foi preservado, é só clicar em salvar novamente.`,
            variant: "destructive",
          });
          return;
        }
      }



      // Enriquecimento pós-insert: preenche doctor_document (CRM/UF) via match por nome
      // contra o cadastro de doctors. Planilhas Rede D'Or não trazem coluna de documento,
      // então sem isso 100% dos itens ficariam órfãos. Falha não bloqueia o fluxo.
      try {
        await supabase.rpc("enrich_doctor_documents", { p_payment_id: payment.id });
      } catch (e) {
        console.warn("[enrich_doctor_documents] falhou (não-bloqueante):", e);
      }
      // Auto-aprendizado: quando o motor casou via CRM/CPF/slug mas o texto bruto
      // diverge do canônico, cria alias auto. Próximas importações resolvem direto.
      // ⚠️ Pulamos em import_mode='historico' — bases antigas não devem contaminar
      // o cadastro com aliases que talvez já estejam errados. Histórico só calcula
      // valores/diferenças para popular DRE; não ensina nada ao motor.
      if (isHistoricoImport) {
        toast({
          title: "Histórico: aprendizado de apelidos desativado",
          description: "Aliases de médicos/convênios/setores não serão registrados neste lote.",
        });
      } else try {
        const learnRows = matchedItems.map((it: any, i: number) => {
          const raw = matchedRawForLearn[i];
          return {
            doctor_id: it.doctor_id,
            doctor_matched_by: it.doctor_matched_by,
            // Sempre priorizar o texto BRUTO capturado da planilha. `it.doctor_name`
            // e `it.agreement_text` são hoje idênticos ao raw, mas o snapshot blinda
            // contra normalizações futuras. `it.sector` seria fatal aqui — é slug.
            doctor_name: raw?.doctor_name ?? it.doctor_name,
            convenio_slug: it.convenio_slug,
            convenio_matched_by: it.convenio_matched_by,
            agreement_text: raw?.agreement_text ?? it.agreement_text,
            sector_slug: it.sector_slug,
            sector_matched_by: it.sector_matched_by,
            sector_raw: raw?.sector_raw ?? null,
          };
        });
        const learned = await learnAliasesFromResolvedRows(learnRows, { doctorReg, convenioReg, sectorReg }, hospital?.id ?? null);
        const total = learned.doctor + learned.convenio + learned.sector;
        if (total > 0) {
          toast({
            title: `Motor aprendeu ${total} apelido${total === 1 ? "" : "s"}`,
            description: `Médicos: ${learned.doctor} · Convênios: ${learned.convenio} · Setores: ${learned.sector}. Próximas importações vão reconhecer essas variações automaticamente.`,
          });
        }
      } catch (e) {
        console.warn("[learn-alias] falhou (não-bloqueante):", e);
      }

    }

    // === Rateio: cria um payment_company_groups por PJ participante do pool ===
    // Em rateio, o trigger sync_payment_company_group ignora o company_id da planilha
    // (ver migration). Materializamos um grupo por participante (percentual > 0)
    // para o lote aparecer organizado pelas PJs do pool, não pela PJ do médico.
    // ⚠️ Rodar SEMPRE em rateio (mesmo com 100% dos itens em quarentena), senão a
    // distribuição automática via doctor→PJ não tem onde alocar.
    if (paymentMode === "rateio" && poolId) {
      try {
        const { data: participants, error: pErr } = await supabase
          .from("pool_participants")
          .select("company_id, percentual, companies:companies!inner(id, name)")
          .eq("pool_id", poolId)
          .gt("percentual", 0);
        if (pErr) throw pErr;
        const rows = (participants ?? [])
          .map((p: any) => ({
            company_id: p.company_id,
            company_name: (p.companies?.name ?? "—").trim() || "—",
          }))
          .filter((r) => r.company_id);
        if (rows.length > 0) {
          const hospitalId = (payment as any).hospital_id ?? hospital?.id;
          const initialStatus = modoConfeccao ? "rascunho" : "em_analise_ia";
          const groupRows = rows.map((r) => ({
            payment_id: payment.id,
            hospital_id: hospitalId,
            company_id: r.company_id,
            company_name: r.company_name,
            items_count: matchedItems.length,
            total_amount: 0,
            bruto_total: 0,
            status: initialStatus,
            confeccao_status: modoConfeccao ? "em_confeccao" : null,
          }));
          const { error: gErr } = await supabase
            .from("payment_company_groups")
            .upsert(groupRows as any, { onConflict: "payment_id,company_id" });
          if (gErr) {
            console.warn("[rateio] falha ao criar grupos por participante:", gErr);
            toast({
              title: "Aviso: grupos do pool não criados",
              description: gErr.message,
              variant: "destructive",
            });
          }
        }
      } catch (e: any) {
        console.warn("[rateio] erro ao montar grupos do pool:", e);
      }
    }




    if (unmatchedItems.length > 0) {
      const CHUNK_U = 250;
      let unErr: any = null;
      for (let i = 0; i < unmatchedItems.length; i += CHUNK_U) {
        const slice = unmatchedItems.slice(i, i + CHUNK_U);
        const { error } = await (supabase as any).rpc("bulk_insert_new_payment_unmatched_items", {
          _payment_id: payment.id,
          _items: slice,
        });
        if (error) { unErr = error; break; }
      }
      if (unErr) {
        await rollbackCreatedPayment("falha ao inserir payment_unmatched_items");
        setSubmitting(false);
        toast({
          title: "Erro ao salvar itens sem PJ",
          description: `${unErr.message}. Nenhum dado foi salvo — pode reenviar.`,
          variant: "destructive",
        });
        return;
      } else {

        // Em rateio: o pool já pré-vinculou as PJs participantes. Resolve unmatched
        // automaticamente via doctor→PJ entre os participantes — não joga em quarentena
        // o que o pool consegue absorver sozinho.
        let autoLinked = 0;
        let stillPending = unmatchedItems.length;
        if (paymentMode === "rateio" && poolId) {
          const rawNames = Array.from(
            new Set(unmatchedItems.map((u) => (u.raw_company_name ?? "").trim()).filter(Boolean)),
          );
          for (const raw of rawNames) {
            try {
              const { data, error } = await supabase.rpc(
                "distribute_unmatched_items_by_doctor",
                { _payment_id: payment.id, _raw_company_name: raw },
              );
              if (error) continue;
              const row = Array.isArray(data) ? data[0] : data;
              autoLinked += Number(row?.linked ?? 0);
            } catch (e) {
              console.warn("[rateio] auto-distribute falhou:", raw, e);
            }
          }
          stillPending = unmatchedItems.length - autoLinked;
        }
        if (autoLinked > 0) {
          toast({
            title: `${autoLinked} item(ns) distribuídos pelas PJs do pool`,
            description: stillPending > 0
              ? `${stillPending} item(ns) sem vínculo médico→PJ permanecem em "Empresas não vinculadas".`
              : "Todos os itens foram absorvidos automaticamente pelo pool.",
          });
        } else {
          toast({
            title: `${unmatchedItems.length} item(ns) em "Empresas não vinculadas"`,
            description: "Esses itens NÃO entram na análise. Resolva pela tela do lote.",
          });
        }
      }
    }

    // Recalibra payments para refletir apenas itens que entram no motor.
    if (unmatchedItems.length > 0) {
      const { data: itemsAfter } = await supabase
        .from("payment_items")
        .select("gross_amount, procedure_amount")
        .eq("payment_id", payment.id);
      const total = (itemsAfter ?? []).reduce((s, r: any) => {
        const paid = Number(r.gross_amount ?? 0);
        const base = Number(r.procedure_amount ?? 0);
        return s + (paid !== 0 ? paid : base);
      }, 0);
      await supabase.from("payments")
        .update({ items_count: itemsAfter?.length ?? matchedItems.length, total_amount: total })
        .eq("id", payment.id);
    }


    // Score preditivo pré-análise — não bloqueia o fluxo se falhar.
    (async () => {
      try {
        const itemCount = matchedItems.length;
        if (itemCount === 0) return;
        const companyNames = Array.from(new Set(matchedItems.map((it) => (it.company_name ?? "").trim()).filter(Boolean)));
        if (companyNames.length === 0) return;
        const profilesMap = await fetchCompanyRiskProfiles(companyNames);
        const profiles = companyNames
          .map((name) => {
            const p = profilesMap.get(name);
            return p ? { company: name, historical_alert_rate: p.alertRate, sample_items: p.totalItems } : null;
          })
          .filter((x): x is { company: string; historical_alert_rate: number; sample_items: number } => x !== null);
        const withHistory = profiles.filter((p) => p.sample_items >= 10);
        const baseRates = (withHistory.length > 0 ? withHistory : profiles).map((p) => p.historical_alert_rate);
        const avgRate = baseRates.length > 0 ? baseRates.reduce((a, b) => a + b, 0) / baseRates.length : 0;
        const baseScore = avgRate * 100;
        const volumeBonus = itemCount > 100 ? Math.min(15, Math.log10(itemCount / 100) * 5) : 0;
        const predictiveScore = Math.round(Math.min(100, baseScore + volumeBonus));
        const scoreLevel: "baixo" | "medio" | "alto" | "critico" =
          predictiveScore < 20 ? "baixo" :
          predictiveScore < 50 ? "medio" :
          predictiveScore < 75 ? "alto" : "critico";

        const { data: cur } = await supabase
          .from("payments")
          .select("processing_diagnostics")
          .eq("id", payment.id)
          .single();
        const prevDiag = (cur?.processing_diagnostics ?? {}) as Record<string, unknown>;
        await supabase.from("payments").update({
          processing_diagnostics: {
            ...prevDiag,
            pre_analysis: {
              predictive_score: predictiveScore,
              score_level: scoreLevel,
              company_profiles: profiles,
              sample_months: 6,
              calculated_at: new Date().toISOString(),
            },
          },
        }).eq("id", payment.id);
      } catch (err) {
        console.warn("[pre_analysis] cálculo falhou:", err);
      }
    })();



    const fileSummary = buckets.map((b) =>
      `${b.file.name} → ${b.matchedCompany ? `${b.matchedCompany.name} (match ${Math.round(b.matchScore * 100)}%)` : `empresa nova: ${b.rawCompanyName}`} · ${b.rows.length} itens`
    ).join(" | ");

    const obsRes = await recordObservation({
      payment_id: payment.id,
      author_type: "sistema",
      author_id: user!.id,
      message: `Lote criado com ${allRows.length} itens, total ${formatCurrency(total)}. Arquivos: ${fileSummary}`,
      status_to: "em_analise_ia",
    });
    if (!obsRes.ok) {
      toast({ title: "Histórico não registrado", description: obsRes.error, variant: "destructive" });
    }

    // Histórico de auditoria — registra a(s) empresa(s) vinculada(s) ao pagamento criado.
    try {
      const { recordAudit, buildDiff } = await import("@/lib/audit");
      const seen = new Set<string>();
      const companyEntries = buckets
        .map((b) => ({
          id: b.matchedCompany?.id ?? null,
          name: b.matchedCompany?.name ?? b.rawCompanyName ?? null,
          document: null as string | null,
        }))
        .filter((c) => {
          const k = `${c.id ?? ""}|${c.name ?? ""}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      const snapshot = {
        reference: reference.trim(),
        total_amount: total,
        items_count: allRows.length,
        payment_type: paymentType,
        payment_kind: paymentKind,
        payment_track: paymentTrack || null,
        competence_month: `${[...competenceMonths].sort()[0]}-01`,
        competence_months: [...competenceMonths].sort().map((m) => `${m}-01`),
        sectors: pSectors,
        specialties: pSpecialties,
      };
      const diff = buildDiff(null, snapshot as any);
      const targets = companyEntries.length ? companyEntries : [null];
      await Promise.all(targets.map((c) => recordAudit({
        entityType: "payment", entityId: payment.id, action: "create",
        actorId: user!.id, company: c, diff,
      })));
    } catch (e) {
      console.warn("[audit] falha não-fatal ao registrar pagamento", e);
    }

    // [Confecção parecer] Antes de disparar o motor, sobe o relatório de pareceres
    // e cruza items↔linhas. Sem isso, o motor não tem como classificar item por
    // item entre Parecer e Visita.
    if (requiresParecerReport && parecerPayload) {
      try {
        const initRes = await supabase.functions.invoke("import-parecer-report", {
          body: {
            mode: "init",
            payment_id: payment.id,
            filename: parecerPayload.fileName,
            file_hash: parecerPayload.fileHash,
            period_start: parecerPayload.periodStart,
            period_end: parecerPayload.periodEnd,
          },
        });
        if (initRes.error) throw initRes.error;
        const reportId = (initRes.data as any)?.report_id as string;
        if (!reportId) throw new Error("Falha ao criar cabeçalho do relatório de parecer");
        const CHUNK = 300;
        let inserted = 0;
        for (let i = 0; i < parecerPayload.rows.length; i += CHUNK) {
          const chunk = parecerPayload.rows.slice(i, i + CHUNK);
          const { error: appErr } = await supabase.functions.invoke("import-parecer-report", {
            body: { mode: "append", report_id: reportId, rows: chunk },
          });
          if (appErr) throw appErr;
          inserted += chunk.length;
        }
        await supabase.functions.invoke("import-parecer-report", {
          body: { mode: "finalize", report_id: reportId, row_count: inserted },
        });
        // Cruza items↔relatório (sem disparar reanalysis — vamos disparar dispatch logo abaixo)
        await supabase.functions.invoke("cross-reference-parecer", {
          body: { payment_id: payment.id, trigger_reanalysis: false },
        });
        toast({
          title: "Relatório de pareceres importado",
          description: `${inserted} linhas · cruzamento concluído.`,
        });
      } catch (e: any) {
        toast({
          title: "Falha ao processar relatório de parecer",
          description: e?.message ?? String(e),
          variant: "destructive",
        });
        // Não bloqueia: o lote já foi criado em rascunho/confecção e o analista
        // pode reanexar pelo PaymentDetail.
      }
    }

    toast({ title: "Lote criado", description: "Iniciando análise..." });
    // Aguarda confirmação do dispatcher. Se falhar (timeout, boot error), reverte
    // status para 'rascunho' para não deixar o lote travado em 'em_analise_ia'.
    try {
      const { data: dispatchData, error: dispatchErr } = await supabase.functions.invoke(
        "dispatch-payment-analysis",
        { body: { payment_id: payment.id, run_ai: includeAiOnSubmit === true } }
      );
      if (dispatchErr) {
        // FunctionsHttpError expõe a Response em .context — usamos para detectar
        // gates de negócio (409 missing_parecer_report) e mostrar mensagem amigável
        // em vez do erro genérico "non-2xx status code".
        let blockedPayload: any = null;
        try {
          const ctx = (dispatchErr as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            blockedPayload = await ctx.clone().json();
          }
        } catch { /* noop */ }
        if (blockedPayload?.blocked && blockedPayload?.reason === "missing_parecer_report") {
          toast({
            title: "Relatório de Parecer obrigatório",
            description: blockedPayload.message || "Anexe o relatório de Parecer do Tasy antes de iniciar a análise. O lote ficou em rascunho — abra o detalhe para enviar o relatório e reanalisar.",
            variant: "destructive",
          });
          if (analysisMode !== "confeccao") {
            await supabase.from("payments").update({ status: "rascunho" as any }).eq("id", payment.id);
          }
        } else {
          throw dispatchErr;
        }
      } else if (dispatchData?.blocked && dispatchData?.reason === "missing_parecer_report") {
        toast({
          title: "Relatório de Parecer obrigatório",
          description: dispatchData.message,
          variant: "destructive",
        });
        if (analysisMode !== "confeccao") {
          await supabase.from("payments").update({ status: "rascunho" as any }).eq("id", payment.id);
        }
      }
    } catch (dispatchErr) {
      const msg = dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr);
      console.error("[dispatch-payment-analysis] falhou ao iniciar", dispatchErr);
      if (analysisMode !== "confeccao") {
        await supabase.from("payments").update({ status: "rascunho" as any }).eq("id", payment.id);
      }
      toast({
        title: "Falha ao iniciar análise",
        description: `${msg}. O lote ficou em rascunho — use "Reanalisar lote" no detalhe para tentar novamente.`,
        variant: "destructive",
      });
    }


    // Substitui a entrada "/pagamentos/novo" no histórico para que o botão Voltar
    // do detalhe leve à lista de pagamentos, e não de volta ao formulário de criação.
    // Submissão concluída: rascunho não é mais necessário.
    if (hospital?.id) {
      clearDraft(hospital.id, analysisMode, paymentModelId);
      draftClearedRef.current = true;
    }
    navigate(`/pagamentos/${payment.id}`, { replace: true, state: { backTo: "/pagamentos" } });
  };

  return (
    <>
      <PageHeader
        title={modoConfeccao ? "Confecção de pagamento" : "Nova base de pagamento"}
        description={modoConfeccao
          ? "Suba a base com o valor do convênio. O sistema aplicará as regras e calculará o repasse automaticamente."
          : "Anexe uma ou várias planilhas. A empresa é detectada pelo nome do arquivo."}
      />
      <div className="p-8 max-w-7xl space-y-6">
        {draftRestoredAt && (
          <div className="rounded-lg border border-blue-300 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm flex items-start gap-3">
            <div className="flex-1">
              <div className="font-semibold text-blue-900 dark:text-blue-200">Rascunho restaurado</div>
              <div className="text-xs text-blue-800 dark:text-blue-300 mt-1">
                Salvo automaticamente em {new Date(draftRestoredAt).toLocaleString("pt-BR")}.
                {Object.keys(pendingFileDecisionsRef.current).length > 0 && (
                  <> Re-anexe os {Object.keys(pendingFileDecisionsRef.current).length} arquivo(s) originais para reaplicar setor, PJ e mapeamento de colunas.</>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={discardDraft}
              className="text-xs text-blue-900 dark:text-blue-200 hover:underline shrink-0"
            >
              Descartar
            </button>
          </div>
        )}
        {paymentModelMeta && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm flex items-start gap-3">
            <div className="rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary uppercase tracking-wide">
              Tipo: {paymentModelMeta.label}
            </div>
            <div className="text-xs text-muted-foreground flex-1 leading-relaxed">
              {paymentModelMeta.tuss_default && !paymentModelMeta.requires_tuss_in_sheet && (
                <div>TUSS <span className="font-mono">{paymentModelMeta.tuss_default}</span> será aplicado automaticamente às linhas sem código.</div>
              )}
              {paymentModelMeta.default_function && (
                <div>Função padrão: <span className="font-medium">{paymentModelMeta.default_function}</span> (preenche linhas sem função).</div>
              )}
              {!paymentModelMeta.tuss_default && paymentModelMeta.requires_tuss_in_sheet && !paymentModelMeta.default_function && !paymentModelMeta.allow_mixed_subtypes && (
                <div>Sem defaults — a planilha precisa trazer TUSS e função para cada linha.</div>
              )}
              {paymentModelMeta.allow_mixed_subtypes && paymentModelMeta.subtype_split_hint && (() => {
                const counts: Record<string, number> = {};
                let mixed = 0;
                for (const r of allRows) {
                  const defaultItemTypeId = paymentModelMeta.item_type_id ?? paymentModelMeta.id;
                  const tid = r.payment_type_id_override ?? defaultItemTypeId;
                  counts[tid] = (counts[tid] ?? 0) + 1;
                  if (r.payment_type_id_override && r.payment_type_id_override !== defaultItemTypeId) mixed++;
                }
                const parts = Object.entries(counts).map(([id, n]) =>
                  `${n} ${subtypeLabels[id] ?? (id === (paymentModelMeta.item_type_id ?? paymentModelMeta.id) ? paymentModelMeta.label : id.slice(0, 6))}`
                );
                return (
                  <div>
                    Subtipos mistos ativos via coluna <span className="font-mono">{paymentModelMeta.subtype_split_hint.column}</span>.
                    {allRows.length > 0 && (
                      <span> {allRows.length} linha(s) → {parts.join(" + ")}{mixed > 0 ? ` (${mixed} reclassificada${mixed === 1 ? "" : "s"})` : ""}.</span>
                    )}
                  </div>
                );
              })()}
              <div className="mt-1">Apenas regras com este tipo (ou sem tipo definido) vão entrar no motor.</div>
            </div>
            <button
              type="button"
              onClick={() => { setPaymentModelId(null); try { sessionStorage.removeItem("newPaymentTypeId"); } catch {} }}
              className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
            >
              Remover
            </button>
          </div>
        )}
        {retroHandoff && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-200">
              Origem: apuração retroativa TASY vs Repasse
            </div>
            <div className="text-xs text-amber-800 dark:text-amber-300 mt-1">
              {retroHandoff.items_count ?? 0} item(ns) acionáveis encaminhados · ID {retroHandoff.reconciliation_id.slice(0, 8)}.
              {retroHandoff.prefilled_count
                ? ` Base de confecção preenchida automaticamente com ${retroHandoff.prefilled_count} item(ns) complementares; ao salvar, o pagamento será vinculado à apuração.`
                : " Ao salvar, o pagamento será vinculado à apuração."}
            </div>
          </div>
        )}
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Identificação</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ref">Referência do lote *</Label>
              <Input id="ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex: Pagamento Médicos Maio/2026" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="competence">Competência (mês de apuração) *</Label>
                <MonthMultiSelect
                  id="competence"
                  value={competenceMonths}
                  onChange={setCompetenceMonths}
                  placeholder="Selecione um ou mais meses"
                />
                <p className="text-xs text-muted-foreground">Você pode marcar mais de um mês quando o lote cobrir várias competências.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="due">Previsão de pagamento</Label>
                <DateInput value={paymentDueDate} onChange={setPaymentDueDate} id="due" />
              </div>
              <div className="space-y-2">
                <Label>Tipo de pagamento *</Label>
                <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
                  <SelectTrigger>
                    <SelectValue placeholder={loadingPaymentTypes ? "Carregando…" : "Selecione o tipo"} />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentTypeOptions.map((t) => (
                      <SelectItem key={t.code} value={t.code}>
                        {t.label}
                        {t.description && <span className="text-xs text-muted-foreground"> — {t.description}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Gerenciar tipos em <span className="font-medium">Cadastros → Tipos de pagamento</span>.
                </p>
              </div>

              {/* Regime de competência */}
              <div className="space-y-2 sm:col-span-2 rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-sm">Regime de competência *</Label>
                <Select value={competenceRegime} onValueChange={(v) => setCompetenceRegime(v as "producao" | "remessa")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="producao">Produção realizada (procedimentos do mês da competência)</SelectItem>
                    <SelectItem value="remessa">Produção remetida (pago quando enviado ao convênio — pode incluir meses anteriores)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Em lotes <span className="font-medium">remetida</span> (ex.: infectologia, nefrologia históricas), a conciliação preserva atendimentos de meses anteriores à competência.
                </p>
                {competenceRegime === "remessa" && (
                  <div className="rounded-md border border-info/40 bg-info-soft/30 p-2.5 text-[11px] text-foreground/85">
                    <div className="font-medium mb-0.5">Competência por item ativada</div>
                    O mês da competência acima vira a <span className="font-medium">janela de remessa</span>. A competência contábil de cada item é derivada automaticamente da <span className="font-medium">data do procedimento</span> na base. Verifique se a coluna de data está mapeada corretamente no passo de importação — itens sem data caem num bucket de revisão (não bloqueia o lote).
                  </div>
                )}
              </div>


              {/* Vínculo com rateio (pool) */}
              <div className="space-y-2 sm:col-span-2 rounded-md border border-info/30 bg-info-soft/20 p-3">
                <Label className="text-sm">Modo de pagamento</Label>
                <Select value={paymentMode} onValueChange={(v) => setPaymentMode(v as "producao" | "rateio")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="producao">Produção (padrão)</SelectItem>
                    <SelectItem value="rateio">Pagamento por rateio (pool)</SelectItem>
                  </SelectContent>
                </Select>

                {(paymentMode === "rateio" || isPlantaoType) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div>
                      <Label className="text-xs">Pool {paymentMode === "rateio" ? "*" : "(opcional)"}</Label>
                      <Select value={poolId} onValueChange={setPoolId}>
                        <SelectTrigger><SelectValue placeholder="Selecione um pool" /></SelectTrigger>
                        <SelectContent>
                          {poolsList.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {isPlantaoType && poolId && (
                      <div>
                        <Label className="text-xs">Dedução do pool a alimentar</Label>
                        <Select value={poolDeductionId} onValueChange={setPoolDeductionId}>
                          <SelectTrigger><SelectValue placeholder="Selecione a dedução" /></SelectTrigger>
                          <SelectContent>
                            {poolDeductionsList.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.descricao || d.tipo}{d.valor_variavel ? " (variável)" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          O valor total deste plantão será lançado automaticamente em <span className="font-medium">Valores mensais</span> do pool (competência {competenceMonths[0] || "—"}).
                        </p>
                      </div>
                    )}

                    {paymentMode === "rateio" && (
                      <>
                        <div>
                          <Label className="text-xs">Fonte da produção</Label>
                          <Select value={rateioSource} onValueChange={(v) => setRateioSource(v as "planilha" | "sintetico")}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="planilha">Planilha de itens (com upload)</SelectItem>
                              <SelectItem value="sintetico">Sintético (sem itens, só valor total)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {rateioSource === "sintetico" && (
                          <div>
                            <Label className="text-xs">Valor total a ratear (R$)</Label>
                            <CurrencyInput
                              value={rateioValorTotal ? Number(rateioValorTotal) : null}
                              onChange={(v) => setRateioValorTotal(v == null ? "" : String(v))}
                              placeholder="R$ 0,00"
                            />
                          </div>
                        )}
                        <p className="text-[11px] text-muted-foreground sm:col-span-2">
                          Participantes, deduções e regras seguem o cadastro do pool. O motor distribui automaticamente entre as PJs após o salvamento.
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Categoria{autoPaymentKind ? "" : " *"}</Label>
                <div className="flex items-center gap-2">
                  <Switch id="auto-pk" checked={autoPaymentKind} onCheckedChange={setAutoPaymentKind} />
                  <Label htmlFor="auto-pk" className="text-xs font-normal text-muted-foreground cursor-pointer">
                    Detectar automaticamente pela base (recomendado)
                  </Label>
                </div>
                {autoPaymentKind ? (
                  <>
                    {detectedKind.kind ? (
                      <p className="text-xs text-muted-foreground">
                        Detectado: <span className="font-medium text-foreground">{PAYMENT_KIND_LABELS[detectedKind.kind]}</span>
                        {detectedKind.dated > 0 && (
                          <> · {detectedKind.current} no período / {detectedKind.past} anteriores</>
                        )}
                      </p>
                    ) : (
                      <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription className="text-xs">
                          Categoria não identificada automaticamente. Você pode selecionar manualmente abaixo (opcional).
                        </AlertDescription>
                      </Alert>
                    )}
                    {!detectedKind.kind && (
                      <Select value={paymentKind} onValueChange={(v) => setPaymentKind(v as PaymentKind)}>
                        <SelectTrigger><SelectValue placeholder="Atual / Pendência / Misto (opcional)" /></SelectTrigger>
                        <SelectContent>
                          {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => (
                            <SelectItem key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </>
                ) : (
                  <Select value={paymentKind} onValueChange={(v) => setPaymentKind(v as PaymentKind)}>
                    <SelectTrigger><SelectValue placeholder="Atual / Pendência / Misto" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAYMENT_KIND_LABELS) as PaymentKind[]).map((k) => (
                        <SelectItem key={k} value={k}>{PAYMENT_KIND_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label>Trilha de pagamento</Label>
                <Select value={paymentTrack} onValueChange={(v) => setPaymentTrack(v as PaymentTrack)}>
                  <SelectTrigger><SelectValue placeholder="Habitual / Prioritário (opcional)" /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAYMENT_TRACK_LABELS) as PaymentTrack[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        <div className="flex flex-col">
                          <span>{PAYMENT_TRACK_LABELS[k]}</span>
                          <span className="text-[10px] text-muted-foreground">{PAYMENT_TRACK_DESCRIPTIONS[k]}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Apenas comercial — define só o prazo de pagamento. Não afeta cálculos ou status. Usado para segmentar relatórios.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Centro de custos <span className="text-destructive">*</span></Label>
                <CostCenterCombobox value={costCenterCode} onChange={setCostCenterCode} placeholder="Buscar por código P12 ou nome…" />
                <p className="text-xs text-muted-foreground">Obrigatório. Define o centro de custos contábil padrão do lote. Pode ser sobrescrito por item depois — itens sem CC herdam este.</p>
              </div>
              {!modoConfeccao && (
              <div className="space-y-4 sm:col-span-2">
                {/* Header Zeev */}
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-md shadow-primary/20">
                      <Bot className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 border-2 border-background rounded-full" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-foreground tracking-tight">
                      Padrão de análise do Zeev <span className="text-primary">— IA de Pagamento</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Como o Zeev deve interpretar o contexto deste lote.</p>
                  </div>
                </div>

                {/* Cards */}
                <RadioGroup
                  value={analysisMode}
                  onValueChange={(v) => setAnalysisMode(v as PaymentAnalysisMode)}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3"
                >
                  {([
                    { k: "padrao" as const, title: "Padrão", badge: "Com histórico", Icon: History },
                    { k: "isolado" as const, title: "Isolado", badge: "Sem histórico", Icon: Focus },
                    { k: "empresa_prioritaria" as const, title: "Prioritário", badge: "Empresa isolada", Icon: Target },
                  ]).map(({ k, title, badge, Icon }) => {
                    const active = analysisMode === k;
                    return (
                      <label
                        key={k}
                        htmlFor={`am-${k}`}
                        className={`group relative flex flex-col items-center text-center p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                          active
                            ? "border-primary bg-primary-soft/30 shadow-md shadow-primary/10"
                            : "border-border bg-card hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-sm"
                        }`}
                      >
                        <RadioGroupItem id={`am-${k}`} value={k} className="sr-only" />
                        <span className={`absolute top-2.5 right-2.5 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${active ? "border-primary bg-background" : "border-border bg-muted/40"}`}>
                          {active && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
                        </span>
                        <div className={`w-12 h-12 mb-3 rounded-2xl flex items-center justify-center transition-colors ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground group-hover:bg-primary/5 group-hover:text-primary"}`}>
                          <Icon className="h-6 w-6" />
                        </div>
                        <div className="text-sm font-bold text-foreground mb-1">{title}</div>
                        <span className={`inline-block px-2 py-0.5 mb-2 text-[9px] font-bold uppercase tracking-widest rounded-full ${active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                          {badge}
                        </span>
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {PAYMENT_ANALYSIS_MODE_DESCRIPTIONS[k]}
                        </p>
                      </label>
                    );
                  })}
                </RadioGroup>
              </div>
              )}
              {!modoConfeccao && canImportHistorico && (
              <div className="space-y-2 sm:col-span-2 rounded-md border border-amber-300/60 bg-amber-50/40 p-3 dark:bg-amber-950/20">
                <div className="flex items-center gap-2">
                  <Switch
                    id="import-historico"
                    checked={isHistoricoImport}
                    onCheckedChange={(v) => setImportMode(v ? "historico" : "normal")}
                  />
                  <Label htmlFor="import-historico" className="cursor-pointer text-sm font-medium">
                    Importação histórica (jan–abr/2026)
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use para subir bases que já transitaram fora do Exacta. O motor roda normalmente (regras,
                  repasses, aprendizado de aliases, KPIs), mas o lote pula validação/aprovação/NF e fica gravado
                  como <strong>PAGO</strong>. Competência permitida: {HISTORICO_WINDOW.start} a {HISTORICO_WINDOW.end}.
                </p>
                {isHistoricoImport && competenceOutOfWindow && (
                  <Alert variant="destructive" className="mt-2">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Competência fora da janela</AlertTitle>
                    <AlertDescription>
                      Selecione apenas meses entre {HISTORICO_WINDOW.start} e {HISTORICO_WINDOW.end}.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              )}

              <div className="space-y-2 sm:col-span-2">
                <Label>Setor(es) / Item Pagamento</Label>
                <div className="flex items-center gap-2">
                  <Switch id="auto-sec" checked={autoSectors} onCheckedChange={setAutoSectors} />
                  <Label htmlFor="auto-sec" className="text-xs font-normal text-muted-foreground cursor-pointer">
                    Detectar automaticamente pela base (recomendado)
                  </Label>
                  {autoSectors && detected.detectedSectors.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      · detectado: {detected.detectedSectors.map((s) => RULE_SECTOR_LABELS[s as RuleSector] ?? s).join(", ")}
                    </span>
                  )}
                </div>
                {!autoSectors && (
                  <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-background p-2 min-h-10">
                    {(Object.keys(RULE_SECTOR_LABELS) as RuleSector[]).map((k) => {
                      const checked = pSectors.includes(k);
                      return (
                        <Button key={k} type="button" size="sm" variant={checked ? "default" : "outline"}
                          onClick={() => setPSectors((p) => checked ? p.filter((x) => x !== k) : [...p, k])}>
                          {RULE_SECTOR_LABELS[k]}
                        </Button>
                      );
                    })}
                  </div>
                )}
                {sectorConflicts.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Conflito com a base</AlertTitle>
                    <AlertDescription>
                      <ul className="list-disc pl-4 space-y-0.5 text-xs">
                        {sectorConflicts.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              {/*
                Especialidade médica é apenas metadado de relatório/busca/filtro
                — não influencia o motor nem a análise. O campo de seleção a
                nível de lote foi removido para evitar configuração que sugira
                impacto em cálculo. A especialidade do item continua sendo
                lida da própria base e usada em filtros/exportações.
              */}
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Descrição</Label>
              <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Observações iniciais (opcional)" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">Arquivos (.xlsx, .xls, .csv)</CardTitle>
                <CardDescription>
                  Pode anexar várias planilhas — cada arquivo representa uma empresa (detectada pelo nome). Colunas reconhecidas: Nr. Atendimento, Paciente, Convênio, Data, Proced/Mat, Via de Acesso, Código TUSS, Qtd, Valor Procedimento, Percentual, Vl. Repasse, Médico, Função.
                </CardDescription>
              </div>
              {buckets.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-shrink-0"
                  disabled={submitting}
                  onClick={() => {
                    // Reset completo do estágio de upload — evita ter que excluir
                    // rascunho e recomeçar quando o analista quer trocar todos
                    // os arquivos de uma vez.
                    const ok = window.confirm(
                      `Remover todos os ${buckets.length} arquivo(s) e recomeçar? Nenhum dado é apagado do banco — apenas o estágio de importação é limpo.`,
                    );
                    if (!ok) return;
                    setBuckets([]);
                    setParseErrors([]);
                    setSuspiciousDecisions({});
                    setBucketFilter("");
                  }}
                >
                  <X className="h-4 w-4 mr-1" /> Limpar todos os arquivos
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            <label
              className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary-soft/30 transition-colors"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
              }}
            >
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                multiple
                className="hidden"
                onChange={(e) => e.target.files && onFiles(e.target.files)}
              />
              <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium">Clique para selecionar ou arraste arquivos</p>
              <p className="text-xs text-muted-foreground mt-1">Excel ou CSV — múltiplos arquivos suportados</p>
            </label>

            {modoConfeccao && (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
                <Calculator className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-primary">Modo confecção ativo</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Suba a base com o valor do convênio (coluna "Valor Procedimento" ou "Valor Convênio").
                    O repasse será calculado automaticamente pelas regras cadastradas após o envio.
                  </p>
                </div>
              </div>
            )}

            {parseErrors.length > 0 && (
              <div className="space-y-2">
                {parseErrors.map((err, i) => (
                  <div key={i} className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-destructive truncate" title={err.fileName}>
                            {err.title} — {err.fileName}
                          </p>
                          <button
                            type="button"
                            onClick={() => setParseErrors((prev) => prev.filter((_, j) => j !== i))}
                            className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                          >
                            Dispensar
                          </button>
                        </div>
                        {err.reasons.length > 0 && (
                          <ul className="text-xs text-foreground/80 space-y-0.5">
                            {err.reasons.map((r, ri) => (
                              <li key={ri} className="whitespace-pre-wrap">{r}</li>
                            ))}
                          </ul>
                        )}
                        {err.howToFix.length > 0 && (
                          <div className="text-xs">
                            <p className="font-medium text-foreground mb-0.5">Como corrigir:</p>
                            <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                              {err.howToFix.map((h, hi) => <li key={hi}>{h}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {buckets.length > 0 && (
              <div className="space-y-2">
                {buckets.length >= 5 && (
                  <div className="flex items-center gap-2 sticky top-0 z-10 bg-background/95 backdrop-blur py-2 -mx-1 px-1 border-b border-border/40">
                    <Input
                      value={bucketFilter}
                      onChange={(e) => setBucketFilter(e.target.value)}
                      placeholder="Filtrar PJ por nome, CNPJ ou arquivo…"
                      className="h-8 text-xs"
                    />
                    {bucketFilter && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        onClick={() => setBucketFilter("")}
                      >
                        Limpar
                      </Button>
                    )}
                  </div>
                )}
                {(() => {
                  // Normaliza: remove acentos (NFD + strip diacríticos), lower, trim.
                  // Aceita busca por "sao", "SÃO", "são" indiferentemente.
                  const norm = (s: unknown) =>
                    String(s ?? "")
                      .normalize("NFD")
                      .replace(/[\u0300-\u036f]/g, "")
                      .toLowerCase()
                      .trim();
                  const digits = (s: unknown) => String(s ?? "").replace(/\D+/g, "");

                  const rawQ = debouncedBucketFilter.trim();
                  const q = norm(rawQ);
                  const qDigits = digits(rawQ);

                  const filtered = buckets
                    .map((b, idx) => ({ b, idx }))
                    .filter(({ b }) => {
                      if (!q && !qDigits) return true;
                      const doc = (b.matchedCompany as any)?.document ?? "";
                      const textMatch = q
                        ? norm(b.matchedCompany?.name).includes(q) ||
                          norm(b.rawCompanyName).includes(q) ||
                          norm(b.file.name).includes(q) ||
                          norm(doc).includes(q)
                        : false;
                      // Busca por CNPJ ignorando pontuação (ex: "12345678" acha "12.345.678/0001-99").
                      const docMatch = qDigits.length >= 3 ? digits(doc).includes(qDigits) : false;
                      return textMatch || docMatch;
                    })
                    .sort((a, z) => {
                      const an = norm(a.b.matchedCompany?.name ?? a.b.rawCompanyName ?? a.b.file.name);
                      const zn = norm(z.b.matchedCompany?.name ?? z.b.rawCompanyName ?? z.b.file.name);
                      return an.localeCompare(zn, "pt-BR", { sensitivity: "base" });
                    });
                  if ((q || qDigits) && filtered.length === 0) {
                    return (
                      <p className="text-xs text-muted-foreground px-2 py-3">
                        Nenhuma PJ encontrada para "{bucketFilter}".
                      </p>
                    );
                  }
                  return filtered.map(({ b, idx }) => (
                  <div key={idx} className="w-full border border-border rounded-lg p-3 flex items-start gap-3 bg-card">
                    <FileSpreadsheet className="h-8 w-8 text-primary flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate" title={b.file.name}>{b.file.name}</p>
                      {(() => {
                        const headerRow = (b.rawMatrix && typeof b.headerRowIndex === "number")
                          ? (b.rawMatrix[b.headerRowIndex] ?? [])
                          : [];
                        const colNames = (headerRow as unknown[])
                          .map((c) => String(c ?? "").trim())
                          .filter((c) => c.length > 0);
                        const totalRows = b.rawMatrix ? Math.max(0, b.rawMatrix.length - ((b.headerRowIndex ?? 0) + 1)) : b.rows.length;
                        const sizeKb = b.file.size / 1024;
                        const sizeLabel = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb.toFixed(0)} KB`;
                        const preview = colNames.slice(0, 6).join(" · ");
                        return (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            <span>{sizeLabel} · {totalRows} linha{totalRows === 1 ? "" : "s"} · {colNames.length} coluna{colNames.length === 1 ? "" : "s"}{typeof b.headerRowIndex === "number" ? ` · cabeçalho na linha ${b.headerRowIndex + 1}` : ""}</span>
                            {preview && (
                              <span className="block truncate" title={colNames.join(" · ")}>
                                Colunas: {preview}{colNames.length > 6 ? ` … +${colNames.length - 6}` : ""}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {paymentMode === "rateio" ? (
                          <>
                            <div
                              className="inline-flex items-center gap-2 rounded-md px-2.5 py-1 max-w-[520px] min-w-0 border border-primary/30 bg-primary/5 text-foreground"
                              title={poolCompanyNames.join(" · ")}
                            >
                              <Building2 className="h-4 w-4 flex-shrink-0 opacity-80" />
                              <span className="truncate font-semibold text-sm">
                                {poolCompanyNames.length === 0
                                  ? "Selecione um pool para ver as PJs"
                                  : poolCompanyNames.length === 1
                                    ? poolCompanyNames[0]
                                    : `Rateio entre ${poolCompanyNames.length} PJs do pool`}
                              </span>
                            </div>
                            {poolCompanyNames.length > 1 && (
                              <Badge variant="secondary" className="gap-1 text-primary border-primary/30 bg-primary/10">
                                PJs: {poolCompanyNames.slice(0, 3).join(", ")}{poolCompanyNames.length > 3 ? ` +${poolCompanyNames.length - 3}` : ""}
                              </Badge>
                            )}
                          </>
                        ) : (
                          <>
                        {(() => {
                          const seen = new Set();
                          b.rows.forEach(r => { if (r.company_id) seen.add(r.company_id); else if (r.company_name) seen.add(r.company_name); });
                          const multi = seen.size > 1;
                          const label = multi ? `Múltiplas empresas (${seen.size})` : (b.matchedCompany?.name ?? b.rawCompanyName ?? "—");
                          const noMatch = !multi && !b.matchedCompany;
                          const sources = new Set(b.rows.map((r) => r.company_source).filter(Boolean) as string[]);
                          const srcLabel =
                            sources.size === 0 ? null
                            : sources.has("planilha") && sources.has("arquivo") ? { text: "PJ: planilha + arquivo", cls: "text-indigo-700 border-indigo-200 bg-indigo-50", tip: "PJ resolvida linha a linha pela coluna da planilha em algumas linhas e pelo nome do arquivo em outras." }
                            : sources.has("planilha") ? { text: "PJ da planilha", cls: "text-indigo-700 border-indigo-200 bg-indigo-50", tip: "PJ resolvida pela coluna de empresa dentro da planilha (linha a linha)." }
                            : sources.has("arquivo") ? { text: "PJ do arquivo", cls: "text-slate-600 border-slate-200 bg-slate-50", tip: "PJ resolvida pelo nome do arquivo (comportamento padrão)." }
                            : null;
                          return (
                            <>
                              <div
                                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 max-w-[420px] min-w-0 border ${
                                  noMatch
                                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                                    : "border-border bg-muted/40 text-foreground"
                                }`}
                                title={label}
                              >
                                <Building2 className="h-4 w-4 flex-shrink-0 opacity-80" />
                                <span className="truncate font-semibold text-sm">{label}</span>
                              </div>
                              {srcLabel && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium cursor-default ${srcLabel.cls}`}>
                                      {srcLabel.text}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent><p className="text-xs max-w-[240px]">{srcLabel.tip}</p></TooltipContent>
                                </Tooltip>
                              )}
                            </>
                          );
                        })()}


                        {b.manualOverride ? (
                          <Badge variant="secondary" className="gap-1 text-success border-success/30 bg-success/10">
                            <CheckCircle2 className="h-3 w-3" /> empresa confirmada
                          </Badge>
                        ) : b.matchScore >= MATCH_AUTO_THRESHOLD ? (
                          <Badge variant="secondary" className="gap-1 text-success border-success/30 bg-success/10">
                            <CheckCircle2 className="h-3 w-3" /> match {Math.round(b.matchScore * 100)}%
                          </Badge>
                        ) : b.matchScore >= MATCH_REVIEW_THRESHOLD ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="gap-1 text-amber-600 border-amber-200 bg-amber-50">
                              <AlertTriangle className="h-3 w-3" /> requer confirmação ({Math.round(b.matchScore * 100)}%)
                            </Badge>
                            {b.matchScore >= MATCH_CONFIRM_MIN ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[10px] border-amber-200 hover:bg-amber-50"
                                onClick={() => confirmBucketCompany(idx)}
                              >
                                Confirmar sugestão
                              </Button>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      disabled
                                      className="h-6 px-2 text-[10px] border-amber-200 opacity-60 cursor-not-allowed"
                                    >
                                      Confirmar bloqueado
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs max-w-[240px]">
                                    Confiança abaixo de {Math.round(MATCH_CONFIRM_MIN * 100)}% — para evitar vínculos incorretos,
                                    escolha manualmente a PJ ou cadastre uma nova.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-destructive border-destructive/30 bg-destructive/10">
                            <AlertCircle className="h-3 w-3" /> sem PJ — itens ficam isolados ({Math.round(b.matchScore * 100)}%)
                          </Badge>
                        )}
                        <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                {b.matchedCompany ? "Trocar empresa" : "Selecionar empresa"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(360px,calc(100vw-2rem))] p-2" align="end" collisionPadding={16}>
                              <p className="text-xs text-muted-foreground mb-2">
                                Escolha a empresa correta. O nome do arquivo será salvo como apelido para reconhecimento automático nas próximas importações.
                              </p>
                              <CompanyCombobox
                                className="w-full"
                                value={
                                  b.matchedCompany
                                    ? { id: b.matchedCompany.id, name: b.matchedCompany.name, document: null }
                                    : null
                                }
                                onChange={(c) => c && overrideBucketCompany(idx, c)}
                                placeholder="Buscar empresa por nome ou CNPJ…"
                              />
                            </PopoverContent>
                          </Popover>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10"
                            onClick={() =>
                              setNewCompanyDialog({
                                idx,
                                name: b.matchedCompany ? "" : (b.rawCompanyName ?? ""),
                                document: "",
                                busy: false,
                              })
                            }
                            title="Cadastrar uma nova PJ e vincular a este arquivo sem sair da tela."
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            Cadastrar nova PJ
                          </Button>
                          </>
                        )}
                        <div className="flex items-center gap-2 flex-wrap flex-1">




                          <div className="flex items-center gap-1.5 px-2 border-l border-r border-border/50 h-6">
                            <Switch 
                              id={`totalized-${idx}`} 
                              checked={b.convenioValueTotalized || false} 
                              onCheckedChange={() => toggleBucketConvenioTotalized(idx)}
                              className="scale-[0.7]"
                            />
                            <Label 
                              htmlFor={`totalized-${idx}`} 
                              className="text-[10px] font-normal text-muted-foreground cursor-pointer leading-tight"
                            >
                              Valor convênio já totalizado
                            </Label>
                          </div>

                          {/* Quando o sistema NÃO detectou setor, o seletor sai do popover e fica
                              direto na barra — analista vê o valor escolhido e não envia "achando" que mapeou. */}
                          {b.sectorMissing && !b.sectorMapping ? (
                            <div className="flex items-center gap-1.5 h-6 px-1.5 border border-destructive/60 rounded animate-pulse">
                              <Label className="text-[10px] font-medium text-destructive whitespace-nowrap">Setor *</Label>
                              <Select
                                value={b.sectorMapping || ""}
                                onValueChange={(v) => {
                                  setBuckets(prev => prev.map((x, i) => i === idx ? { ...x, sectorMapping: v } : x));
                                  toast({ title: "Setor aplicado", description: `${RULE_SECTOR_LABELS[v as RuleSector] ?? v} — vale para todas as linhas deste arquivo.` });
                                }}
                              >
                                <SelectTrigger className="h-5 text-[11px] border-0 bg-transparent px-1 min-w-[160px]"><SelectValue placeholder="Escolha o setor…" /></SelectTrigger>
                                <SelectContent>
                                  {(Object.keys(RULE_SECTOR_LABELS) as RuleSector[]).map(s => (
                                    <SelectItem key={s} value={s} className="text-xs">{RULE_SECTOR_LABELS[s]}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                {`Setor: ${b.sectorMapping ? (RULE_SECTOR_LABELS[b.sectorMapping as RuleSector] ?? b.sectorMapping) : "Auto"}`}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(420px,calc(100vw-2rem))] p-3" align="end">
                              <div className="space-y-3">
                                <div className="space-y-1">
                                  <h4 className="text-sm font-medium">Coluna e mapeamento de setor</h4>
                                  <p className="text-xs text-muted-foreground">
                                    O sistema procura pelo cabeçalho (Setor, Unidade, Departamento, Lotação…) e, quando não acha, compara os valores com os setores cadastrados.
                                    A decisão final é sempre sua.
                                  </p>
                                </div>

                                {/* --- Coluna identificada como Setor --- */}
                                {(() => {
                                  const det = b.sectorColumnDetection;
                                  const headers = Array.from(new Set(b.rows.flatMap(r => Object.keys(r.raw_data || {})))).filter(Boolean);
                                  const used = b.sectorColumnUsed ?? null;
                                  return (
                                    <div className="space-y-2 rounded-md border border-border p-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <Label className="text-xs">Coluna lida como setor</Label>
                                        {det && det.confidence === "header" && (
                                          <Badge variant="outline" className="h-4 text-[9px] border-emerald-500/40 text-emerald-600">cabeçalho reconhecido</Badge>
                                        )}
                                        {det && det.confidence === "values" && !used && (
                                          <Badge variant="outline" className="h-4 text-[9px] border-amber-500/40 text-amber-600 animate-pulse">confirme</Badge>
                                        )}
                                        {det && det.confidence === "none" && (
                                          <Badge variant="outline" className="h-4 text-[9px] border-destructive/50 text-destructive">não encontrada</Badge>
                                        )}
                                      </div>
                                      <Select
                                        value={used ?? "__auto__"}
                                        onValueChange={(v) => applySectorColumn(idx, v === "__auto__" ? null : v)}
                                      >
                                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Detectar por sinônimos" /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="__auto__" className="text-xs italic">Detectar por sinônimos (Setor / Unidade / Depto…)</SelectItem>
                                          {headers.map((h) => (
                                            <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>

                                      {det && det.candidates.length > 0 && (
                                        <div className="space-y-1.5">
                                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Sugestões da IA</p>
                                          {det.candidates.slice(0, 4).map((c) => {
                                            const isUsed = used === c.header;
                                            return (
                                              <button
                                                key={c.header}
                                                type="button"
                                                onClick={() => applySectorColumn(idx, c.header)}
                                                className={`w-full text-left rounded border px-2 py-1.5 text-[11px] transition-colors ${isUsed ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/40"}`}
                                              >
                                                <div className="flex items-center justify-between gap-2">
                                                  <span className="font-medium truncate">{c.header}</span>
                                                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                    {c.reason === "header" ? "nome bate" : `${Math.round(c.matchRate * 100)}% dos valores casam`}
                                                  </span>
                                                </div>
                                                {c.sampleValues.length > 0 && (
                                                  <div className="text-[10px] text-muted-foreground truncate">
                                                    ex.: {c.sampleValues.join(" · ")}
                                                  </div>
                                                )}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()}

                                {/* --- Override do setor canônico --- */}
                                <div className="space-y-1">
                                  <Label className="text-xs">Forçar setor (fallback)</Label>
                                  <Select
                                    value={b.sectorMapping || "auto"}
                                    onValueChange={(v) => {
                                      setBuckets(prev => prev.map((x, i) => i === idx ? { ...x, sectorMapping: v === "auto" ? null : v } : x));
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="auto" className="text-xs italic">Usar o que vier da coluna</SelectItem>
                                      {(Object.keys(RULE_SECTOR_LABELS) as RuleSector[]).map(s => (
                                        <SelectItem key={s} value={s} className="text-xs">{RULE_SECTOR_LABELS[s]}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <p className="text-[10px] text-muted-foreground">Aplica este setor a TODAS as linhas que não trouxeram setor reconhecido.</p>
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                          )}

                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant={b.rows.length === 0 ? "outline" : "ghost"}
                                className={`h-6 px-2 text-[11px] ${b.rows.length === 0 ? "border-destructive text-destructive hover:text-destructive" : "text-muted-foreground hover:text-foreground"}`}
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Cabeçalho: linha {(b.headerRowIndex ?? 0) + 1}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(480px,calc(100vw-2rem))] p-3" align="end" collisionPadding={16}>
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <h4 className="text-sm font-medium">Escolher linha de cabeçalho</h4>
                                  <p className="text-xs text-muted-foreground">
                                    Se o sistema não detectou as colunas (0 linhas) ou pegou a linha errada, escolha aqui qual linha da planilha contém os nomes das colunas.
                                  </p>
                                </div>
                                <div className="max-h-72 overflow-auto border rounded">
                                  {(b.rawMatrix || []).slice(0, 30).map((row, rIdx) => {
                                    const preview = (row || [])
                                      .slice(0, 10)
                                      .map((c) => (c == null || c === "" ? "·" : String(c)))
                                      .join(" | ");
                                    const isCurrent = rIdx === (b.headerRowIndex ?? 0);
                                    return (
                                      <button
                                        key={rIdx}
                                        type="button"
                                        onClick={() => applyHeaderRowOverride(idx, rIdx)}
                                        className={`w-full text-left text-[11px] px-2 py-1.5 border-b last:border-b-0 hover:bg-muted/60 ${isCurrent ? "bg-primary/10 font-medium" : ""}`}
                                      >
                                        <span className="text-muted-foreground mr-2">Linha {rIdx + 1}:</span>
                                        <span className="truncate inline-block max-w-full align-bottom">{preview || "(vazia)"}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>

                          {/* Botão de revisão do mapeamento de colunas */}
                          {(() => {
                            const hits = b.mappingHits ?? [];
                            const summary = hits.length ? summarizeMissing(hits, paymentModelMeta, modoConfeccao ? "confeccao" : "analise") : { missingRequired: [], lowConfidence: [] };
                            const hasMissing = summary.missingRequired.length > 0;
                            const hasLow = summary.lowConfidence.length > 0;
                            const variant = hasMissing ? "outline" : "ghost";
                            const klass = hasMissing
                              ? "border-destructive text-destructive hover:text-destructive"
                              : hasLow
                                ? "border-amber-500 text-amber-700 hover:text-amber-700"
                                : "text-muted-foreground hover:text-foreground";
                            const label = b.appliedTemplate
                              ? `Mapeamento (template: ${b.appliedTemplate.name.slice(0, 18)}${b.appliedTemplate.name.length > 18 ? "…" : ""})`
                              : hasMissing
                                ? `Mapeamento: ${summary.missingRequired.length} faltando`
                                : hasLow
                                  ? `Mapeamento: ${summary.lowConfidence.length} revisar`
                                  : "Mapeamento de colunas";
                            return (
                              <Button
                                type="button"
                                size="sm"
                                variant={variant as "outline" | "ghost"}
                                className={`h-6 px-2 text-[11px] ${hasMissing ? "border" : ""} ${klass}`}
                                onClick={() => setMappingDialog({ open: true, bucketIdx: idx })}
                              >
                                <Sparkles className="h-3 w-3 mr-1" />
                                {label}
                              </Button>
                            );
                          })()}


                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Colunas{b.columnOverrides && (b.columnOverrides.doctor || b.columnOverrides.gross || b.columnOverrides.repasse) ? " ✓" : ""}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[min(380px,calc(100vw-2rem))] p-3" align="end" collisionPadding={16}>
                              {(() => {
                                const headers = Array.from(new Set(b.rows.flatMap(r => Object.keys(r.raw_data || {})))).filter(Boolean);
                                const ov = b.columnOverrides || {};
                                const NONE = "__auto__";
                                const renderSelect = (label: string, key: keyof ColumnOverrides, help: string) => (
                                  <div className="space-y-1">
                                    <Label className="text-xs">{label}</Label>
                                    <Select
                                      value={ov[key] ?? NONE}
                                      onValueChange={(v) => applyColumnOverrides(idx, { ...ov, [key]: v === NONE ? undefined : v })}
                                    >
                                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={NONE} className="text-xs italic">Detectar automaticamente</SelectItem>
                                        {headers.map(h => (
                                          <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <p className="text-[10px] text-muted-foreground">{help}</p>
                                  </div>
                                );
                                return (
                                  <div className="space-y-3">
                                    <div className="space-y-1">
                                      <h4 className="text-sm font-medium">Mapear colunas manualmente</h4>
                                      <p className="text-xs text-muted-foreground">
                                        Quando o sistema não identifica corretamente as colunas, escolha aqui qual cabeçalho representa cada campo.
                                      </p>
                                    </div>
                                    {renderSelect("Médico (prestador)", "doctor", "Coluna com o nome do médico que recebe o repasse.")}
                                    {renderSelect("Valor bruto (convênio)", "gross", "Valor cobrado do convênio / valor do procedimento.")}
                                    {renderSelect("Valor a repassar", "repasse", "Valor líquido que deve ser pago ao médico.")}
                                  </div>
                                );
                              })()}
                            </PopoverContent>
                          </Popover>
                        </div>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {b.rows.length} linhas · {formatCurrency(b.rows.reduce((s, r) => s + r.gross_amount, 0))}
                        </span>
                      </div>
                      {(suspiciousByBucket[idx]?.length ?? 0) > 0 && (
                        <SuspiciousRowsReview
                          fileName={b.file.name}
                          rows={suspiciousByBucket[idx]}
                          decisions={Object.fromEntries(
                            (suspiciousByBucket[idx] ?? [])
                              .map((r) => [r.rowNumber, suspiciousDecisions[decisionKey(b.file.name, r.rowNumber)]])
                              .filter(([, v]) => !!v) as [number, SuspiciousDecision][]
                          )}
                          onDecide={(rn, d) =>
                            setSuspiciousDecisions((prev) => ({ ...prev, [decisionKey(b.file.name, rn)]: d }))
                          }
                        />
                      )}
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title="Substituir arquivo"
                        onClick={() => {
                          const input = document.createElement("input");
                          input.type = "file";
                          input.accept = ".xlsx,.xls,.csv";
                          input.onchange = () => {
                            const f = input.files?.[0];
                            if (f) replaceBucketFile(idx, f);
                          };
                          input.click();
                        }}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" onClick={() => removeBucket(idx)} title="Remover arquivo">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  ));
                })()}
                <p className="text-xs text-muted-foreground">
                  Total: {allRows.length} itens · {formatCurrency(total)}
                </p>
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Pré-validação por tipo de linha
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(preValidation.byType).map(([k, n]) => (
                      <Badge key={k} variant="outline" className="text-xs">
                        {LINE_TYPE_LABELS[k as LineType] ?? k}: {n}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-3 text-xs">
                    {preValidation.critical > 0 ? (
                      <span className="text-destructive font-medium">
                        {preValidation.critical} erro(s) crítico(s) — bloqueia envio
                      </span>
                    ) : (
                      <span className="text-success">Nenhum erro crítico</span>
                    )}
                    {preValidation.warnings > 0 && (
                      <span className="text-warning">{preValidation.warnings} alerta(s) leve(s)</span>
                    )}
                  </div>
                  {rowsWithIssues.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border/70">
                      <p className="text-xs font-medium text-foreground">Itens com pendências</p>
                      <div className="space-y-2 max-h-72 overflow-auto pr-1">
                        {rowsWithIssues.slice(0, 30).map((r, i) => {
                          const bucketIndex = r.source_bucket_index;
                          const rowIndex = r.source_row_index;
                          const canEdit = typeof bucketIndex === "number" && typeof rowIndex === "number";
                          const applyRowChange = (changes: Partial<ParsedRow>) => {
                            if (typeof bucketIndex !== "number" || typeof rowIndex !== "number") return;
                            updateRow(bucketIndex, rowIndex, changes);
                          };
                          return (
                            <div key={`${r.source_file}-${r.source_row_number}-${i}`} className="rounded-md border border-border bg-background p-3 space-y-2">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <Badge variant="outline">Linha {r.source_row_number ?? "—"}</Badge>
                                <Badge variant="secondary">{LINE_TYPE_LABELS[r.tipo_linha]}</Badge>
                                <span className="text-muted-foreground truncate">{r.source_file}</span>
                              </div>
                              <ul className="list-disc pl-4 text-xs space-y-0.5">
                                {r.line_issues.map((issue, issueIdx) => (
                                  <li key={issueIdx} className={issue.severity === "critico" ? "text-destructive" : "text-warning"}>
                                    {issue.message} <span className="text-muted-foreground">({issue.field})</span>
                                  </li>
                                ))}
                              </ul>
                              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Tipo</Label>
                                  <Select disabled={!canEdit} value={r.tipo_linha} onValueChange={(v) => applyRowChange({ tipo_linha_manual: v as LineType })}>
                                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {(Object.keys(LINE_TYPE_LABELS) as LineType[]).map((type) => (
                                        <SelectItem key={type} value={type}>{LINE_TYPE_LABELS[type]}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="space-y-1 sm:col-span-2">
                                  <Label className="text-xs">Médico</Label>
                                  <Input className="h-8 text-xs" disabled={!canEdit} value={r.doctor_name} onChange={(e) => applyRowChange({ doctor_name: e.target.value })} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Valor</Label>
                                  <Input className="h-8 text-xs" disabled={!canEdit} value={r.gross_amount ? String(r.gross_amount).replace(".", ",") : ""} onChange={(e) => {
                                    const parsed = normalizeNumericValue(e.target.value);
                                    applyRowChange({ gross_amount: parsed.value, valor_invalido: parsed.invalid });
                                  }} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">TUSS</Label>
                                  <Input className="h-8 text-xs" disabled={!canEdit} value={r.procedure_code ?? ""} onChange={(e) => applyRowChange({ procedure_code: e.target.value })} />
                                </div>
                                <div className="space-y-1 sm:col-span-5">
                                  <Label className="text-xs">Descrição</Label>
                                  <Input className="h-8 text-xs" disabled={!canEdit} value={r.description || r.procedure_name || ""} onChange={(e) => applyRowChange({ description: e.target.value, procedure_name: e.target.value })} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {rowsWithIssues.length > 30 && (
                        <p className="text-xs text-muted-foreground">Mostrando 30 de {rowsWithIssues.length} itens com pendências.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {allRows.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr className="text-left">
                        <th className="px-2 py-2 font-medium">Empresa</th>
                        <th className="px-2 py-2 font-medium">Médico</th>
                        <th className="px-2 py-2 font-medium">Função</th>
                        <th className="px-2 py-2 font-medium">TUSS</th>
                        <th className="px-2 py-2 font-medium">Via</th>
                        <th className="px-2 py-2 font-medium">Acordo</th>
                        <th className="px-2 py-2 font-medium text-right">Repasse</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {allRows.slice(0, 60).map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5 truncate max-w-[140px]">{r.company_name ?? "—"}</td>
                          <td className="px-2 py-1.5 truncate max-w-[140px]">{r.doctor_name || "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{r.doctor_role ?? "—"}</td>
                          <td className="px-2 py-1.5 tabular-nums">{r.procedure_code ?? "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]">{r.access_route ?? "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[120px]">{r.agreement_text ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.gross_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {allRows.length > 60 && (
                  <p className="text-xs text-muted-foreground text-center py-2 bg-muted/40">
                    Mostrando 60 de {allRows.length} linhas
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {uniqueCompanyNames.length > 0 && (
          <CompanyRiskProfileList companyNames={uniqueCompanyNames} />
        )}

        {allRows.length > 0 && !registriesReady && (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Carregando cadastros oficiais</AlertTitle>
            <AlertDescription>
              Estou carregando médicos, convênios e setores para validar a base antes do envio.
            </AlertDescription>
          </Alert>
        )}

        {allRows.length > 0 && doctorReg && convenioReg && sectorReg && (
          <RegistryResolutionPanel
            unresolved={unresolvedGroups}
            doctorReg={doctorReg}
            convenioReg={convenioReg}
            sectorReg={sectorReg}
            onResolved={() => reloadRegistries(true)}
          />
        )}

        {showMixedParecerOption && (
          <MixedParecerSetupCard
            value={mixedParecer}
            onChange={setMixedParecer}
            ambiguousTussCount={ambiguousTussCount}
          />
        )}

        {requiresParecerReport && (
          <ParecerReportWizardCard
            competenceMonths={competenceMonths}
            tasyAttendanceKeys={(() => {
              const byCrm = new Set<string>();
              const byName = new Set<string>();
              const onlyD = (s: any) => String(s ?? "").replace(/\D+/g, "");
              const norm = (s: any) =>
                String(s ?? "")
                  .normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .toLowerCase()
                  .replace(/[^a-z0-9 ]+/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();
              for (const r of allRows) {
                const att = onlyD(r.attendance_number);
                if (!att) continue;
                const crmD = onlyD(r.doctor_document);
                if (crmD) byCrm.add(`${att}|${crmD}`);
                const nm = norm(r.doctor_name);
                if (nm) byName.add(`${att}|${nm}`);
              }
              return { byCrm, byName };
            })()}
            value={parecerPayload}
            onChange={setParecerPayload}
          />
        )}

        {requiresSpecialtyOnAllRows && pendingSpecialtyRows.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 flex items-center justify-between gap-2">
            <div className="text-sm">
              <strong>{pendingSpecialtyRows.length}</strong> item(ns) sem especialidade. Em confecção parecer,
              a especialidade é obrigatória para o motor decidir Parecer vs Visita.
            </div>
            <Button size="sm" variant="outline" onClick={() => setSpecialtyModalOpen(true)}>
              Informar especialidades
            </Button>
          </div>
        )}

        <SpecialtyResolutionModal
          open={specialtyModalOpen}
          onOpenChange={setSpecialtyModalOpen}
          rows={pendingSpecialtyRows}
          initialOverrides={specialtyOverrides}
          suggestionsByDoctor={(() => {
            const map: Record<string, string[]> = {};
            if (!doctorReg) return map;
            for (const e of doctorReg.byAlias.values()) {
              const k = (e.full_name ?? "").trim().toLowerCase();
              if (k && !map[k]) map[k] = e.specialties ?? [];
            }
            return map;
          })()}
          onConfirm={(ov) => setSpecialtyOverrides((prev) => ({ ...prev, ...ov }))}
        />


        <div className="flex flex-wrap items-center justify-end gap-3">
          {!modoConfeccao && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
              <input
                type="checkbox"
                checked={includeAiOnSubmit}
                onChange={(e) => setIncludeAiOnSubmit(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              Incluir justificativas IA
            </label>
          )}
          <Button variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting || allRows.length === 0 || !registriesReady || hasUnresolved || pendingSuspiciousCount > 0 || !costCenterCode || (requiresParecerReport && !parecerPayload) || (requiresSpecialtyOnAllRows && pendingSpecialtyRows.length > 0) || (mixedParecer.enabled && !mixedParecer.item_type_id)}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {pendingSuspiciousCount > 0

              ? `Revise ${pendingSuspiciousCount} linha${pendingSuspiciousCount === 1 ? "" : "s"} suspeita${pendingSuspiciousCount === 1 ? "" : "s"}`
              : !registriesReady
                ? "Carregando cadastros oficiais"
              : hasUnresolved
              ? `Resolva ${blockingUnresolved.length} cadastro${blockingUnresolved.length === 1 ? "" : "s"} para continuar`
                : !costCenterCode
                  ? "Selecione o centro de custos"
                  : requiresParecerReport && !parecerPayload
                    ? "Anexe o relatório de pareceres"
                    : sectorOnlyUnresolvedCount > 0
                      ? (modoConfeccao ? "Criar e calcular (setores serão ignorados)" : "Criar e analisar (setores serão ignorados)")
                      : modoConfeccao ? "Criar e calcular repasse" : "Criar e analisar"}
          </Button>
        </div>

      </div>

      {mappingDialog.bucketIdx !== null && buckets[mappingDialog.bucketIdx] && (() => {
        const refHeaders = buckets[mappingDialog.bucketIdx].detectedHeaders ?? [];
        const compatibleCount = buckets.reduce((acc, b, i) => {
          if (i === mappingDialog.bucketIdx) return acc;
          return sameHeaderSet(refHeaders, b.detectedHeaders) ? acc + 1 : acc;
        }, 0);
        return (
          <ColumnMappingDialog
            open={mappingDialog.open}
            onOpenChange={(open) => setMappingDialog((d) => ({ ...d, open }))}
            fileName={buckets[mappingDialog.bucketIdx].file.name}
            headers={buckets[mappingDialog.bucketIdx].detectedHeaders ?? []}
            initialMapping={
              buckets[mappingDialog.bucketIdx].columnMapping
              ?? Object.fromEntries(
                (buckets[mappingDialog.bucketIdx].mappingHits ?? [])
                  .filter((h) => h.header)
                  .map((h) => [h.field, h.header!]),
              )
            }
            sampleRow={buckets[mappingDialog.bucketIdx].sampleRow}
            hospitalId={hospital?.id ?? null}
            mode={modoConfeccao ? "confeccao" : "analise"}
            compatibleCount={compatibleCount}
            paymentTypeMeta={paymentModelMeta ? {
              tuss_default: paymentModelMeta.tuss_default,
              requires_tuss_in_sheet: paymentModelMeta.requires_tuss_in_sheet,
              default_function: paymentModelMeta.default_function,
            } : null}
            onApply={(mapping, applyToCompatible) => {
              applyColumnMappingOverride(mappingDialog.bucketIdx!, mapping, applyToCompatible);
            }}
          />
        );
      })()}

      <Dialog
        open={!!newCompanyDialog}
        onOpenChange={(o) => !o && !newCompanyDialog?.busy && setNewCompanyDialog(null)}
      >
        <DialogContent className="max-w-[min(32rem,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="pr-10 break-words leading-snug">
              Cadastrar nova PJ
            </DialogTitle>
          </DialogHeader>
          {newCompanyDialog && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                A empresa será criada no cadastro geral e vinculada a este arquivo.
                {(() => {
                  const raw = buckets[newCompanyDialog.idx]?.rawCompanyName?.trim();
                  return raw ? ` "${raw}" será salvo como apelido para reconhecer automaticamente nas próximas importações.` : "";
                })()}
              </p>
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input
                  value={newCompanyDialog.name}
                  onChange={(e) =>
                    setNewCompanyDialog((d) => (d ? { ...d, name: e.target.value } : d))
                  }
                  placeholder="Razão social ou nome fantasia"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label>CNPJ (opcional)</Label>
                <Input
                  value={newCompanyDialog.document}
                  onChange={(e) =>
                    setNewCompanyDialog((d) => (d ? { ...d, document: e.target.value } : d))
                  }
                  placeholder="00.000.000/0000-00"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNewCompanyDialog(null)}
              disabled={!!newCompanyDialog?.busy}
            >
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!newCompanyDialog) return;
                setNewCompanyDialog((d) => (d ? { ...d, busy: true } : d));
                const ok = await registerAndBindNewCompany(
                  newCompanyDialog.idx,
                  newCompanyDialog.name,
                  newCompanyDialog.document,
                );
                if (ok) {
                  setNewCompanyDialog(null);
                } else {
                  setNewCompanyDialog((d) => (d ? { ...d, busy: false } : d));
                }
              }}
              disabled={!newCompanyDialog || newCompanyDialog.busy || !newCompanyDialog.name.trim()}
            >
              {newCompanyDialog?.busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Cadastrar e vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <ZeevAssistant
        pageLabel={modoConfeccao ? "Confecção de pagamento" : "Novo lote de pagamento"}
        summary={{ arquivos: buckets.length, linhas: allRows.length, suspeitas_pendentes: pendingSuspiciousCount }}
        stagingContext={stagingContext}
        extraInsights={zeevStagingInsights}
      />
    </>
  );
};

export default NewPayment;

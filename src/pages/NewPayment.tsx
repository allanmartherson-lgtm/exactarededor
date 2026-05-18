import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import { toast } from "@/hooks/use-toast";
import { recordObservation } from "@/lib/observations";
import { formatCurrency, PAYMENT_TYPE_LABELS, PAYMENT_KIND_LABELS, type PaymentType, type PaymentKind } from "@/lib/status";
import { PAYMENT_ANALYSIS_MODE_LABELS, PAYMENT_ANALYSIS_MODE_DESCRIPTIONS, type PaymentAnalysisMode } from "@/lib/status";
import { FileSpreadsheet, Loader2, Sparkles, Upload, X, Building2, CheckCircle2, AlertCircle, Pencil } from "lucide-react";
import { CompanyCombobox, type CompanyOption } from "@/components/CompanyCombobox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RULE_SECTOR_LABELS, type RuleSector } from "@/lib/status";
import { normalizeNumericValue } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle } from "lucide-react";
import {
  similarity,
  extractCompanyFromFilename,
  matchCompany,
  MATCH_AUTO_THRESHOLD,
  MATCH_REVIEW_THRESHOLD,
} from "@/lib/parsePaymentFile";

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

const COMPLEMENTO_TERMS = [
  "bonus", "bônus", "complemento", "adicional", "diferenca", "diferença",
  "ajuste de valor", "complemento pacote", "complemento cirurg",
  "produtividade", "incentivo", "valor complementar",
];
const GLOSA_TERMS = ["glosa", "desconto", "abatimento", "devolução", "devolucao", "estorno", "ajuste negativo"];
const REPROC_TERMS = ["retroativo", "pendência", "pendencia", "competência anterior", "competencia anterior", "ajuste mês anterior", "ajuste mes anterior"];
const PACOTE_TERMS = ["pacote"];
const VISITA_TERMS = ["visita"];
const PARECER_TERMS = ["parecer"];
const CIRURGIA_TERMS = ["cirurgia", "cirurg", "procedimento"];

const containsAny = (txt: string, terms: string[]) => {
  const t = txt.toLowerCase();
  return terms.some((w) => t.includes(w.toLowerCase()));
};

const classifyLine = (
  r: Omit<ParsedRow, "tipo_linha" | "line_issues">,
  paymentKind?: string | null,
): LineType => {
  const blob = `${r.description ?? ""} ${r.procedure_name ?? ""} ${r.doctor_role ?? ""}`;
  if (containsAny(blob, GLOSA_TERMS) || (r.gross_amount ?? 0) < 0) return "glosa_desconto";
  if (containsAny(blob, COMPLEMENTO_TERMS)) return "complemento_bonus";
  if (paymentKind === "pendencia" || containsAny(blob, REPROC_TERMS)) return "reprocessamento";
  if (containsAny(blob, PACOTE_TERMS)) return "pacote";
  if (containsAny(blob, VISITA_TERMS)) return "visita";
  if (containsAny(blob, PARECER_TERMS)) return "parecer";
  if (r.procedure_code || containsAny(blob, CIRURGIA_TERMS)) return "procedimento";
  return "outro";
};

const validateLine = (
  r: Omit<ParsedRow, "line_issues">,
): LineIssue[] => {
  const issues: LineIssue[] = [];
  const hasDoctor = !!r.doctor_name?.trim();
  const hasValue = Math.abs(r.gross_amount ?? 0) > 0;
  const hasAtt = !!r.attendance_number?.trim() || !!r.patient_name?.trim();
  const hasCode = !!r.procedure_code?.trim();
  const hasDesc = !!(r.description?.trim() || r.procedure_name?.trim());

  if (r.valor_invalido) {
    issues.push({ severity: "critico", field: "gross_amount", message: "Valor numérico inválido ou negativo detectado na linha" });
  }

  switch (r.tipo_linha) {
    case "procedimento":
      if (!hasDoctor) issues.push({ severity: "critico", field: "doctor_name", message: "Médico obrigatório" });
      if (!hasValue) issues.push({ severity: "critico", field: "gross_amount", message: "Valor obrigatório" });
      if (!hasCode && !hasDesc) issues.push({ severity: "critico", field: "procedure_code", message: "Código TUSS ou descrição obrigatório" });
      if (!hasAtt) issues.push({ severity: "alerta", field: "attendance_number", message: "Atendimento/paciente recomendado" });
      break;
    case "visita":
    case "parecer":
      if (!hasDoctor) issues.push({ severity: "critico", field: "doctor_name", message: "Médico obrigatório" });
      if (!hasValue) issues.push({ severity: "critico", field: "gross_amount", message: "Valor obrigatório" });
      break;
    case "pacote":
      if (!hasValue) issues.push({ severity: "critico", field: "gross_amount", message: "Valor total obrigatório" });
      if (!hasAtt) issues.push({ severity: "critico", field: "attendance_number", message: "Atendimento/paciente obrigatório no pacote" });
      if (!hasCode) issues.push({ severity: "alerta", field: "procedure_code", message: "Código principal recomendado" });
      break;
    case "complemento_bonus":
      if (!hasDoctor) issues.push({ severity: "critico", field: "doctor_name", message: "Médico obrigatório" });
      if (!hasValue) issues.push({ severity: "critico", field: "gross_amount", message: "Valor obrigatório" });
      if (!hasAtt) issues.push({ severity: "alerta", field: "attendance_number", message: "Atendimento ausente — recomendado" });
      break;
    case "glosa_desconto":
      if (!hasValue) issues.push({ severity: "critico", field: "gross_amount", message: "Valor obrigatório" });
      if (!hasDesc) issues.push({ severity: "critico", field: "description", message: "Motivo/descrição obrigatório" });
      break;
    case "reprocessamento":
      if (!hasValue) issues.push({ severity: "critico", field: "gross_amount", message: "Valor obrigatório" });
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
  /** Se verdadeiro, o valor do convênio nesta planilha já é o total (Unitário * Qtd). */
  convenioValueTotalized?: boolean;
  /** Override manual de colunas quando o auto-detect falha em planilhas atípicas. */
  columnOverrides?: ColumnOverrides;
  /** Matriz crua da planilha (linhas x colunas), para permitir trocar a linha de cabeçalho. */
  rawMatrix?: unknown[][];
  /** Índice (0-based) da linha de cabeçalho atualmente usada. */
  headerRowIndex?: number;
}

interface CompanyRow { id: string; name: string; aliases: string[] }

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

const excelDateToISO = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0))).toISOString();
  }
  const s = String(v).trim();
  // dd/mm/yyyy [hh:mm]
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh, mi] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh || 0), Number(mi || 0))).toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [competenceMonths, setCompetenceMonths] = useState<string[]>([]); // ["YYYY-MM", ...]
  const [paymentDueDate, setPaymentDueDate] = useState(""); // YYYY-MM-DD
  const [paymentType, setPaymentType] = useState<PaymentType | "">("");
  const [paymentKind, setPaymentKind] = useState<PaymentKind | "">("");
  const [costCenterCode, setCostCenterCode] = useState<string | null>(null);
  const [pSectors, setPSectors] = useState<string[]>([]);
  const [pSpecialties, setPSpecialties] = useState<string[]>([]);
  const [buckets, setBuckets] = useState<FileBucket[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [analysisMode, setAnalysisMode] = useState<PaymentAnalysisMode>("padrao");
  const [autoPaymentType, setAutoPaymentType] = useState(true);
  const [autoSectors, setAutoSectors] = useState(true);
  const [autoSpecialties, setAutoSpecialties] = useState(true);
  const [autoPaymentKind, setAutoPaymentKind] = useState(true);

  useEffect(() => { document.title = "Nova base | MedPay Approval"; }, []);

  useEffect(() => {
    supabase.from("companies").select("id,name,aliases").limit(5000).then(({ data }) => {
      setCompanies((data ?? []).map((c: any) => ({ id: c.id, name: c.name, aliases: c.aliases ?? [] })));
    });
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
  ): ParsedRow[] => {
    return json.map((row, rowIndex) => {
      const role = toStr(pick(row, ["funcao", "função", "papel"]));
      const r_repasse = normalizeNumericValue(pick(row, ["vl repasse", "valor repasse", "valor a repassar", "valor repassar", "vlrepasse", "vl. repasse"]));
      const r_procVal = normalizeNumericValue(pick(row, ["valor procedimento", "valor proce", "vl proce", "vlproce", "valor convenio", "valor convênio", "vl convenio", "vl. convenio"]));
      const r_gross = normalizeNumericValue(pick(row, ["valor bruto", "vlrbruto", "bruto", "valor"], ["repasse"]));
      const r_qty = normalizeNumericValue(pick(row, ["qtd", "quantidade", "quant"]));

      const repasse = r_repasse.value;
      const procVal = r_procVal.value;
      const grossFromAny = repasse || r_gross.value || procVal;
      const procedureAmountFinal = procVal || grossFromAny || null;
      const quantity = r_qty.value || null;
      const valor_invalido = r_repasse.invalid || r_procVal.invalid || r_gross.invalid || r_qty.invalid;

      const rowCompanyNameRaw = toStr(pick(row, ["empresa", "hospital", "unidade", "unidade de atendimento", "pj", "fornecedor"]));
      let rowMatchedCompany: CompanyRow | null = null;
      if (!filenameTrusted && rowCompanyNameRaw) {
        const { company: matched, score: s } = matchCompany(rowCompanyNameRaw, companies);
        if (s >= MATCH_AUTO_THRESHOLD) rowMatchedCompany = matched;
      }
      const rawSector = toStr(pick(row, ["setor", "unidade", "departamento", "servico", "serviço"]));
      const resolvedCompany = filenameTrusted ? company : (rowMatchedCompany || company);
      const resolvedName = resolvedCompany?.name
        ?? (filenameTrusted ? company!.name : (rowCompanyNameRaw || rawCompanyName))
        ?? null;

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
        procedure_date: excelDateToISO(pick(row, [
          "data procedimento", "data atendimento", "data dmy", "data",
          "dt resposta", "dt. resp", "dt resp", "data resposta",
          "dt solic", "dt. solic", "data solicitacao", "data solicitação",
        ])),
        patient_name: toStr(pick(row, ["paciente", "nome paciente", "nm paciente", "nome do paciente"])),
        sector: rawSector,
        attendance_character: toStr(pick(row, ["tipo entrada","tipo de entrada","carater","caráter","carater atendimento","caráter atendimento","carater do atendimento","caráter do atendimento","tipo internacao","tipo internação"])),
        raw_data: row,
        source_file: f.name,
        source_row_number: headerOffset + 2 + rowIndex,
      };
      const tipo_linha = classifyLine(base, paymentKind || null);
      const withType = { ...base, tipo_linha };
      const line_issues = validateLine(withType);
      return { ...withType, line_issues } as ParsedRow;
    }).filter((r) => r.doctor_name || Math.abs(r.gross_amount) > 0 || r.procedure_code || r.description);
  };

  const parseFile = async (f: File): Promise<FileBucket> => {
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // Lê como matriz para localizar a linha de cabeçalho real — muitas
    // planilhas trazem totalizadores/metadados antes da linha de cabeçalho.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
    const headerIdx = detectHeaderRow(matrix);
    const json = matrixToJson(matrix, headerIdx);

    const rawCompanyName = extractCompanyFromFilename(f.name);
    const { company, score } = matchCompany(rawCompanyName, companies);
    const filenameTrusted = score >= MATCH_AUTO_THRESHOLD && !!company;

    const rows = mapJsonToRows(json, f, headerIdx, company, filenameTrusted, rawCompanyName);

    const sectorCounts: Record<string, number> = {};
    for (const r of rows) {
      if (r.sector) {
        const s = r.sector.toLowerCase().trim();
        sectorCounts[s] = (sectorCounts[s] ?? 0) + 1;
      }
    }
    const dominantSectorRaw = Object.entries(sectorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    return {
      file: f,
      rows,
      rawCompanyName,
      matchedCompany: company ? { id: company.id, name: company.name } : null,
      matchScore: score,
      sectorMapping: dominantSectorRaw ? (RULE_SECTOR_LABELS as any)[dominantSectorRaw] ? dominantSectorRaw : null : null,
      rawMatrix: matrix,
      headerRowIndex: headerIdx,
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
      const filenameTrusted = bucket.matchScore >= MATCH_AUTO_THRESHOLD && !!bucket.matchedCompany;
      const company = bucket.matchedCompany
        ? (companies.find((c) => c.id === bucket.matchedCompany!.id) ?? null)
        : null;
      const rows = mapJsonToRows(json, bucket.file, newHeaderIdx, company, filenameTrusted, bucket.rawCompanyName);
      return { ...bucket, rows, headerRowIndex: newHeaderIdx };
    }));
    toast({ title: "Cabeçalho atualizado", description: `Linha ${newHeaderIdx + 1} usada como cabeçalho.` });
  };



  const onFiles = async (fileList: FileList) => {
    const newBuckets: FileBucket[] = [];
    for (const f of Array.from(fileList)) {
      try { newBuckets.push(await parseFile(f)); }
      catch (e) { toast({ title: `Erro lendo ${f.name}`, description: String(e), variant: "destructive" }); }
    }
    setBuckets((prev) => [...prev, ...newBuckets]);
    if (!reference && newBuckets.length === 1) {
      setReference(newBuckets[0].file.name.replace(/\.[^.]+$/, ""));
    } else if (!reference && newBuckets.length > 1) {
      const today = new Date();
      setReference(`Pagamento ${today.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`);
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
    // Aprendizado: adiciona o nome bruto do arquivo como alias da empresa correta.
    // Só faz isso quando o usuário trocou de fato a sugestão automática.
    if (previousId !== picked.id) {
      try {
        const rawAlias = b.rawCompanyName?.trim();
        const current = companies.find((c) => c.id === picked.id);
        const aliases = new Set([...(current?.aliases ?? [])]);
        if (rawAlias && !aliases.has(rawAlias)) aliases.add(rawAlias);
        await supabase.from("companies").update({ aliases: Array.from(aliases) }).eq("id", picked.id);
        // Atualiza o cache local de companies para refletir o novo alias
        setCompanies((prev) =>
          prev.map((c) => (c.id === picked.id ? { ...c, aliases: Array.from(aliases) } : c)),
        );
        toast({
          title: "Empresa atualizada",
          description: `"${rawAlias}" foi salvo como apelido de ${picked.name}. Próximas importações com esse nome serão reconhecidas automaticamente.`,
        });
      } catch (e) {
        // Falha de aprendizado não bloqueia a troca — apenas avisa.
        toast({
          title: "Empresa atualizada (sem aprender apelido)",
          description: `Troca aplicada, mas não foi possível salvar o apelido: ${String(e)}`,
        });
      }
    }
  };
  
  /**
   * Confirma a sugestão automática de empresa (quando o match é < 90%).
   */
  const confirmBucketCompany = (idx: number) => {
    const b = buckets[idx];
    if (!b || !b.matchedCompany) return;
    
    setBuckets((prev) =>
      prev.map((x, i) =>
        i === idx
          ? {
              ...x,
              manualOverride: true,
              rows: x.rows.map((r) => ({ 
                ...r, 
                company_id: x.matchedCompany!.id, 
                company_name: x.matchedCompany!.name 
              })),
            }
          : x,
      ),
    );
    toast({
      title: "Empresa confirmada",
      description: `A sugestão "${b.matchedCompany.name}" foi aceita para este arquivo.`,
    });
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
          return { ...withType, line_issues: validateLine(withType) } as ParsedRow;
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
              rows: bucket.rows.map((row, rIdx) => (rIdx === rowIndex ? { ...row, ...changes } : row)),
            },
      ),
    );
  };

  const allRows = useMemo(() => {
    return buckets.flatMap((b, bucketIndex) => b.rows.map((r, rowIndex) => ({ ...r, source_bucket_index: bucketIndex, source_row_index: rowIndex }))).map((r) => {
      const tipo_linha = r.tipo_linha_manual ?? classifyLine(r, paymentKind || null);
      const withType = { ...r, tipo_linha };
      return { ...withType, line_issues: validateLine(withType) };
    });
  }, [buckets, paymentKind]);
  const total = allRows.reduce((s, r) => s + r.gross_amount, 0);

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
    if (competenceMonths.length === 0) {
      toast({ title: "Selecione ao menos um mês de competência", variant: "destructive" }); return;
    }
    if (!autoPaymentKind && !paymentKind) {
      toast({ title: "Selecione a categoria do pagamento", variant: "destructive" }); return;
    }
    if (!autoPaymentType && !paymentType) {
      toast({ title: "Selecione o tipo de pagamento ou marque a detecção automática", variant: "destructive" }); return;
    }
    if (allRows.length === 0) {
      toast({ title: "Carregue pelo menos um arquivo válido", variant: "destructive" }); return;
    }
    // Buckets sem identificação confiável (e sem override manual) viram itens órfãos
    // em payment_unmatched_items: NÃO entram no motor até serem resolvidos.
    const isUnmatchedBucket = (b: FileBucket) =>
      !b.manualOverride && (!b.matchedCompany || b.matchScore < MATCH_AUTO_THRESHOLD);
    const unmatchedBuckets = buckets.filter(isUnmatchedBucket);
    if (unmatchedBuckets.length > 0) {
      const ok = confirm(
        `${unmatchedBuckets.length} arquivo(s) sem PJ identificada com confiança suficiente.\n\n` +
        `Esses itens ficarão isolados em "Empresas não vinculadas" e NÃO entrarão na análise. ` +
        `Você poderá vincular/cadastrar a empresa depois pela tela do lote.\n\nProsseguir mesmo assim?`,
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
    if (sectorConflicts.length > 0) {
      const ok = confirm(`Conflito detectado entre seleção manual e a base:\n\n${sectorConflicts.join("\n")}\n\nDeseja prosseguir mesmo assim?`);
      if (!ok) return;
    }
    setSubmitting(true);

    // Upload de todos os arquivos
    const uploadedPaths: string[] = [];
    for (const b of buckets) {
      const path = `${user!.id}/${Date.now()}-${b.file.name}`;
      const { error: upErr } = await supabase.storage.from("payment-files").upload(path, b.file);
      if (!upErr) uploadedPaths.push(path);
    }

    const { data: payment, error } = await supabase
      .from("payments")
      .insert({
        reference: reference.trim(),
        description: description.trim() || null,
        status: "em_analise_ia",
        total_amount: total,
        items_count: allRows.length,
        source_file_path: uploadedPaths[0] ?? null,
        created_by: user!.id,
        competence_month: `${[...competenceMonths].sort()[0]}-01`,
        competence_months: [...competenceMonths].sort().map((m) => `${m}-01`),
        payment_due_date: paymentDueDate || null,
        payment_type: autoPaymentType ? null : (paymentType as PaymentType),
        payment_kind: (paymentKind || null) as PaymentKind | null,
        cost_center_code: costCenterCode,
        sectors: autoSectors ? [] : pSectors,
        specialties: autoSpecialties ? [] : pSpecialties,
        analysis_mode: analysisMode,
      })
      .select()
      .single();

    if (error || !payment) {
      setSubmitting(false);
      toast({ title: "Erro ao criar pagamento", description: error?.message, variant: "destructive" });
      return;
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
      const crm = onlyDigits(r.doctor_document);
      if (crm && doctorSpecByCRM[crm]) return doctorSpecByCRM[crm];
      if (r.doctor_name && doctorSpecByName[r.doctor_name]) return doctorSpecByName[r.doctor_name];
      return null;
    };

    // Constrói uma linha de payment_items para uma row "matched"
    const buildItemRow = (r: ParsedRow, currentBucket: FileBucket | undefined) => ({
      payment_id: payment.id,
      doctor_name: r.doctor_name,
      doctor_document: r.doctor_document,
      doctor_email: r.doctor_email,
      description: r.description,
      gross_amount: r.gross_amount,
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
      patient_name: r.patient_name,
      sector: currentBucket?.sectorMapping || r.sector,
      attendance_character: r.attendance_character,
      raw_data: r.raw_data as never,
      tipo_linha: r.tipo_linha,
      convenio_value_totalized: currentBucket?.convenioValueTotalized || false,
    });

    // Constrói uma linha de payment_unmatched_items (quarentena — não entra no motor)
    const buildUnmatchedRow = (r: ParsedRow, b: FileBucket) => ({
      payment_id: payment.id,
      source_file: b.file.name,
      raw_company_name: (b.rawCompanyName || r.company_name || "—").trim(),
      match_score: b.matchScore || 0,
      match_suggestion_id: b.matchedCompany?.id ?? null,
      match_suggestion_name: b.matchedCompany?.name ?? null,
      doctor_name: r.doctor_name,
      doctor_document: r.doctor_document,
      doctor_email: r.doctor_email,
      description: r.description,
      gross_amount: r.gross_amount,
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
      patient_name: r.patient_name,
      sector: b.sectorMapping || r.sector,
      attendance_character: r.attendance_character,
      raw_data: r.raw_data as never,
      tipo_linha: r.tipo_linha,
      convenio_value_totalized: b.convenioValueTotalized || false,
    });

    const matchedItems: ReturnType<typeof buildItemRow>[] = [];
    const unmatchedItems: ReturnType<typeof buildUnmatchedRow>[] = [];
    let offset = 0;
    for (const b of buckets) {
      const isUnmatched = isUnmatchedBucket(b);
      for (let j = 0; j < b.rows.length; j++) {
        const r = allRows[offset + j];
        if (isUnmatched) unmatchedItems.push(buildUnmatchedRow(r, b));
        else matchedItems.push(buildItemRow(r, b));
      }
      offset += b.rows.length;
    }

    if (matchedItems.length > 0) {
      const { error: itemsErr } = await supabase.from("payment_items").insert(matchedItems);
      if (itemsErr) {
        setSubmitting(false);
        toast({ title: "Erro ao salvar itens", description: itemsErr.message, variant: "destructive" });
        return;
      }
    }
    if (unmatchedItems.length > 0) {
      const { error: unErr } = await supabase.from("payment_unmatched_items").insert(unmatchedItems);
      if (unErr) {
        toast({
          title: "Aviso: itens órfãos não registrados",
          description: `${unmatchedItems.length} item(ns) sem PJ identificada não foram salvos: ${unErr.message}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: `${unmatchedItems.length} item(ns) em "Empresas não vinculadas"`,
          description: "Esses itens NÃO entram na análise. Resolva pela tela do lote.",
        });
      }
    }

    // Recalibra payments para refletir apenas itens que entram no motor.
    if (unmatchedItems.length > 0) {
      const matchedTotal = matchedItems.reduce((s, it) => s + (Number(it.gross_amount) || 0), 0);
      await supabase.from("payments")
        .update({ items_count: matchedItems.length, total_amount: matchedTotal })
        .eq("id", payment.id);
    }

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

    toast({ title: "Lote criado", description: "Iniciando análise por IA..." });
    supabase.functions.invoke("dispatch-payment-analysis", { body: { payment_id: payment.id } });

    // Substitui a entrada "/pagamentos/novo" no histórico para que o botão Voltar
    // do detalhe leve à lista de pagamentos, e não de volta ao formulário de criação.
    navigate(`/pagamentos/${payment.id}`, { replace: true, state: { backTo: "/pagamentos" } });
  };

  return (
    <>
      <PageHeader title="Nova base de pagamento" description="Anexe uma ou várias planilhas. A empresa é detectada pelo nome do arquivo." />
      <div className="p-8 max-w-5xl space-y-6">
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
                <Input id="due" type="date" value={paymentDueDate} onChange={(e) => setPaymentDueDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Tipo de pagamento *</Label>
                <div className="flex items-center gap-2">
                  <Switch id="auto-pt" checked={autoPaymentType} onCheckedChange={setAutoPaymentType} />
                  <Label htmlFor="auto-pt" className="text-xs font-normal text-muted-foreground cursor-pointer">
                    Detectar automaticamente pela base (recomendado)
                  </Label>
                </div>
                {!autoPaymentType && (
                  <Select value={paymentType} onValueChange={(v) => setPaymentType(v as PaymentType)}>
                    <SelectTrigger><SelectValue placeholder="Selecione manualmente" /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((k) => (
                        <SelectItem key={k} value={k}>{PAYMENT_TYPE_LABELS[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              <div className="space-y-2 sm:col-span-2">
                <Label>Centro de custos (padrão do lote)</Label>
                <CostCenterCombobox value={costCenterCode} onChange={setCostCenterCode} placeholder="Buscar por código P12 ou nome…" />
                <p className="text-xs text-muted-foreground">Pode ser sobrescrito por item depois. Itens sem centro herdam este.</p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Modo de análise</Label>
                <RadioGroup value={analysisMode} onValueChange={(v) => setAnalysisMode(v as PaymentAnalysisMode)} className="grid gap-2">
                  {(Object.keys(PAYMENT_ANALYSIS_MODE_LABELS) as PaymentAnalysisMode[]).map((k) => (
                    <label key={k} htmlFor={`am-${k}`} className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${analysisMode === k ? "border-primary bg-primary-soft/30" : "border-border hover:bg-muted/40"}`}>
                      <RadioGroupItem id={`am-${k}`} value={k} className="mt-0.5" />
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">{PAYMENT_ANALYSIS_MODE_LABELS[k]}</div>
                        <div className="text-xs text-muted-foreground">{PAYMENT_ANALYSIS_MODE_DESCRIPTIONS[k]}</div>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              </div>
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
            <CardTitle className="text-base">Arquivos (.xlsx, .xls, .csv)</CardTitle>
            <CardDescription>
              Pode anexar várias planilhas — cada arquivo representa uma empresa (detectada pelo nome). Colunas reconhecidas: Nr. Atendimento, Paciente, Convênio, Data, Proced/Mat, Via de Acesso, Código TUSS, Qtd, Valor Procedimento, Percentual, Vl. Repasse, Médico, Função.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary-soft/30 transition-colors">
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

            {buckets.length > 0 && (
              <div className="space-y-2">
                {buckets.map((b, idx) => (
                  <div key={idx} className="border border-border rounded-lg p-3 flex items-start gap-3 bg-card">
                    <FileSpreadsheet className="h-8 w-8 text-primary flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{b.file.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className="gap-1">
                          <Building2 className="h-3 w-3" />
                          {(() => {
                            const seen = new Set();
                            b.rows.forEach(r => { if (r.company_id) seen.add(r.company_id); else if (r.company_name) seen.add(r.company_name); });
                            return seen.size > 1 ? `Múltiplas empresas (${seen.size})` : (b.matchedCompany?.name ?? b.rawCompanyName);
                          })()}
                        </Badge>
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
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-6 px-2 text-[10px] border-amber-200 hover:bg-amber-50"
                              onClick={() => confirmBucketCompany(idx)}
                            >
                              Confirmar sugestão
                            </Button>
                          </div>
                        ) : (
                          <Badge variant="secondary" className="gap-1 text-destructive border-destructive/30 bg-destructive/10">
                            <AlertCircle className="h-3 w-3" /> sem PJ — itens ficam isolados ({Math.round(b.matchScore * 100)}%)
                          </Badge>
                        )}
                        <div className="flex items-center gap-2 flex-wrap flex-1">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
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

                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                <Pencil className="h-3 w-3 mr-1" />
                                Setor: {b.sectorMapping ? (RULE_SECTOR_LABELS[b.sectorMapping as RuleSector] ?? b.sectorMapping) : "Auto"}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-3" align="end">
                              <div className="space-y-3">
                                <div className="space-y-1">
                                  <h4 className="text-sm font-medium">Mapear setor</h4>
                                  <p className="text-xs text-muted-foreground">Forçar um setor para todos os itens deste arquivo.</p>
                                </div>
                                <Select 
                                  value={b.sectorMapping || "auto"} 
                                  onValueChange={(v) => {
                                    setBuckets(prev => prev.map((x, i) => i === idx ? { ...x, sectorMapping: v === "auto" ? null : v } : x));
                                  }}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="auto" className="text-xs italic">Detectar automaticamente</SelectItem>
                                    {(Object.keys(RULE_SECTOR_LABELS) as RuleSector[]).map(s => (
                                      <SelectItem key={s} value={s} className="text-xs">{RULE_SECTOR_LABELS[s]}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </PopoverContent>
                          </Popover>

                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
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

                          <Popover>
                            <PopoverTrigger asChild>
                              <Button
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
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeBucket(idx)} className="flex-shrink-0">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
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

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
          <Button onClick={submit} disabled={submitting || allRows.length === 0}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Criar e analisar com IA
          </Button>
        </div>
      </div>
    </>
  );
};

export default NewPayment;

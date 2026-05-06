// Parser compartilhado de arquivos Excel de base de pagamento.
// Extraído de src/pages/NewPayment.tsx para reutilização no reimport.
import * as XLSX from "xlsx";

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

export interface ParsedRow {
  doctor_name: string;
  doctor_document: string;
  doctor_email: string;
  description: string;
  gross_amount: number;
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
  raw_data: Record<string, unknown>;
  tipo_linha: LineType;
  line_issues: LineIssue[];
}

export interface CompanyRow { id: string; name: string; aliases: string[] }

export interface FileBucket {
  file: File;
  rows: ParsedRow[];
  rawCompanyName: string;
  matchedCompany: { id: string; name: string } | null;
  matchScore: number;
  manualOverride?: boolean;
}

const COMPLEMENTO_TERMS = ["bonus","bônus","complemento","adicional","diferenca","diferença","ajuste de valor","complemento pacote","complemento cirurg","produtividade","incentivo","valor complementar"];
const GLOSA_TERMS = ["glosa","desconto","abatimento","devolução","devolucao","estorno","ajuste negativo"];
const REPROC_TERMS = ["retroativo","pendência","pendencia","competência anterior","competencia anterior","ajuste mês anterior","ajuste mes anterior"];
const PACOTE_TERMS = ["pacote"];
const VISITA_TERMS = ["visita"];
const PARECER_TERMS = ["parecer"];
const CIRURGIA_TERMS = ["cirurgia","cirurg","procedimento"];

const containsAny = (txt: string, terms: string[]) => {
  const t = txt.toLowerCase();
  return terms.some((w) => t.includes(w.toLowerCase()));
};

export const classifyLine = (
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

export const validateLine = (r: Omit<ParsedRow, "line_issues">): LineIssue[] => {
  const issues: LineIssue[] = [];
  const hasDoctor = !!r.doctor_name?.trim();
  const hasValue = Math.abs(r.gross_amount ?? 0) > 0;
  const hasAtt = !!r.attendance_number?.trim() || !!r.patient_name?.trim();
  const hasCode = !!r.procedure_code?.trim();
  const hasDesc = !!(r.description?.trim() || r.procedure_name?.trim());
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

const norm = (s: string) => (s ?? "").toString().toLowerCase().trim().replace(/[\s_\-./]+/g, "");

const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    const nk = norm(k);
    for (const rk of Object.keys(row)) if (norm(rk) === nk) return row[rk];
  }
  for (const k of keys) {
    const nk = norm(k);
    for (const rk of Object.keys(row)) if (norm(rk).includes(nk)) return row[rk];
  }
  return undefined;
};

const toNumber = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(?:[,.]|$))/g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
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
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh, mi] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh || 0), Number(mi || 0))).toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const lev = (a: string, b: string): number => {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
};
export const similarity = (a: string, b: string): number => {
  const an = norm(a), bn = norm(b);
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  if (an.includes(bn) || bn.includes(an)) return 0.9;
  const d = lev(an, bn);
  return 1 - d / Math.max(an.length, bn.length);
};

export const extractCompanyFromFilename = (filename: string): string => {
  let name = filename.replace(/\.[^.]+$/, "");
  name = name.replace(/\s*-\s*(centro\s*cirurgico|cc|hemodin[âa]mica|consultas?|pareceres?|ambulatorial)\b.*$/i, "");
  name = name.replace(/\s+\d{1,2}[-_/]\d{2,4}.*$/, "");
  name = name.replace(/\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*/i, "");
  return name.trim();
};

export const matchCompany = (rawName: string, companies: CompanyRow[]): { company: CompanyRow | null; score: number } => {
  if (!companies.length) return { company: null, score: 0 };
  let best: { company: CompanyRow | null; score: number } = { company: null, score: 0 };
  for (const c of companies) {
    const candidates = [c.name, ...(c.aliases || [])];
    for (const cand of candidates) {
      const s = similarity(rawName, cand);
      if (s > best.score) best = { company: c, score: s };
    }
  }
  return best;
};

export const parsePaymentFile = async (
  f: File,
  companies: CompanyRow[],
  paymentKind?: string | null,
): Promise<FileBucket> => {
  const buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  const rawCompanyName = extractCompanyFromFilename(f.name);
  const { company, score } = matchCompany(rawCompanyName, companies);

  const rows: ParsedRow[] = json.map((row) => {
    const role = toStr(pick(row, ["funcao","função","papel"]));
    const repasse = toNumber(pick(row, ["vl repasse","valor repasse","vlrepasse","repasse","vl. repasse"]));
    const procVal = toNumber(pick(row, ["valor procedimento","valor proce","vl proce","vlproce"]));
    const grossFromAny = repasse || toNumber(pick(row, ["valor bruto","valor","vlrbruto","bruto"])) || procVal;

    const base = {
      doctor_name: toStr(pick(row, ["medico","médico","nome","prestador","fornecedor"])) ?? "",
      doctor_document: toStr(pick(row, ["cpf","cnpj","documento","doc"])) ?? "",
      doctor_email: toStr(pick(row, ["email","e-mail"])) ?? "",
      description: toStr(pick(row, ["procedmat","proced/mat","proced.","procedimento","descricao","descrição","servico","serviço"])) ?? "",
      gross_amount: grossFromAny,
      company_name: company?.name ?? rawCompanyName ?? null,
      company_id: company?.id ?? null,
      attendance_number: toStr(pick(row, ["nr atendimento","n atendimento","atendimento","nratendim"])),
      procedure_code: toStr(pick(row, ["codigo procedimento","código procedimento","codigoproc","codproc","cod. tuss","tuss"])),
      procedure_name: toStr(pick(row, ["procedmat","proced/mat","proced.","procedimento"])),
      access_route: toStr(pick(row, ["via de acesso","viaacesso","via acesso"])),
      doctor_role: role,
      agreement_text: toStr(pick(row, ["convenio","convênio","acordo"])),
      specialty: toStr(pick(row, ["especialidade","especialid","especialidade médica","especialidade medica"])) || null,
      procedure_amount: procVal || null,
      quantity: toNumber(pick(row, ["qtd","quantidade"])) || null,
      procedure_date: excelDateToISO(pick(row, ["data"])),
      patient_name: toStr(pick(row, ["paciente","nome paciente","nm paciente","nome do paciente"])),
      raw_data: row,
    };
    const tipo_linha = classifyLine(base, paymentKind || null);
    const withType = { ...base, tipo_linha };
    const line_issues = validateLine(withType);
    return { ...withType, line_issues } as ParsedRow;
  }).filter((r) => r.doctor_name || Math.abs(r.gross_amount) > 0 || r.procedure_code || r.description);

  return { file: f, rows, rawCompanyName, matchedCompany: company ? { id: company.id, name: company.name } : null, matchScore: score };
};

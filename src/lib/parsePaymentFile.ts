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
  sector: string | null;
  /** Caráter do atendimento (ELETIVO / URGENCIA / EMERGENCIA) — usado pelo motor para filtros de bônus. */
  attendance_character: string | null;
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

/**
 * Escolhe o valor de uma coluna usando match com PONTUAÇÃO:
 *   - igualdade normalizada: 100
 *   - header começa com a chave: 60
 *   - header contém a chave:   30
 *   - bônus pela posição da chave na lista (chaves anteriores valem mais)
 *
 * `excludes` permite descartar headers que contenham termos proibidos
 * (ex.: ao buscar o "médico", excluir colunas como "Medico Solic." que
 * representam o solicitante, não o prestador).
 *
 * Por que isso existe: cada planilha de origem tem cabeçalhos um pouco
 * diferentes. Antes o `pick` retornava o PRIMEIRO header que contivesse a
 * palavra-chave, então "Medico Solic." vencia "Médico Parecerista" só por
 * estar antes na planilha — cruzava colunas errado.
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
      // bônus: chaves no início da lista têm preferência (são as mais canônicas)
      s += Math.max(0, 10 - idx);
      if (s > score) score = s;
    });
    if (score > bestScore) {
      bestScore = score;
      bestKey = rk;
    }
  });
  return bestKey != null ? row[bestKey] : undefined;
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

// ===== Levenshtein normalizado =====
const lev = (a: string, b: string): number => {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
};
const levSim = (a: string, b: string): number => {
  const an = norm(a), bn = norm(b);
  if (!an || !bn) return 0;
  if (an === bn) return 1;
  if (an.includes(bn) || bn.includes(an)) return 0.9;
  const d = lev(an, bn);
  return 1 - d / Math.max(an.length, bn.length);
};

// ===== Tokenização + stopwords =====
// Stopwords jurídicas, organizacionais e palavras de baixo valor para identificar PJs hospitalares.
const STOPWORDS = new Set([
  "ltda","me","epp","eireli","sa","s","s.a","s.a.","ss","s.s","s.s.","sc","s.c",
  "hospital","hospitalar","instituto","clinica","clínica","centro","cirurgico","cirúrgico",
  "saude","saúde","servicos","serviços","servico","serviço","medico","médico","medica","médica",
  "consultorio","consultório","de","da","do","das","dos","e","&","cia","grupo","unidade",
  "ltd","comercio","comércio","empresarial","cnpj",
]);

const stripDiacritics = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const tokenize = (s: string): string[] => {
  if (!s) return [];
  const cleaned = stripDiacritics(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
};

const jaccard = (a: string[], b: string[]): number => {
  if (!a.length && !b.length) return 0;
  const sa = new Set(a), sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
};

// Score híbrido: 0.65 Jaccard de tokens + 0.35 Levenshtein normalizado.
// Bônus quando todos os tokens significativos do nome curto cabem no longo.
export const similarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const ta = tokenize(a), tb = tokenize(b);
  const j = jaccard(ta, tb);
  const l = levSim(a, b);
  let score = 0.65 * j + 0.35 * l;
  // bônus contenção de tokens (raro caso curto/longo)
  if (ta.length && tb.length) {
    const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const setLong = new Set(longer);
    const allIn = shorter.every((t) => setLong.has(t));
    if (allIn && shorter.length >= 2) score = Math.max(score, 0.92);
  }
  return Math.min(1, score);
};

// ===== Extração de empresa do nome do arquivo =====
// Remove tokens de período, prefixos de cópia/versão, sufixos de setor e separadores.
export const extractCompanyFromFilename = (filename: string): string => {
  let name = filename.replace(/\.[^.]+$/, ""); // remove extensão
  // normaliza underscores em espaços ANTES de aplicar regras (analistas usam "_" como separador)
  name = name.replace(/_+/g, " ");
  // remove prefixos comuns de gestão de arquivo
  name = name.replace(/^(c[oó]pia\s+(de\s+)?|copy\s+of\s+|final\s*[-_]?\s*|v\d+\s*[-_]?\s*)/i, "");
  // remove sufixos de versão/contador
  name = name.replace(/\s*\(\d+\)\s*$/g, "");
  name = name.replace(/[\s_\-]+v\d+\s*$/i, "");
  // remove sufixos de setor/conteúdo
  name = name.replace(/\s*[-_]\s*(centro\s*cirurgico|cc|hemodin[âa]mica|consultas?|pareceres?|ambulatorial|visitas?|cirurgi[ao]s?|ambulat[oó]rio|uti|enfermaria|interna[cç][aã]o)\b.*$/i, "");
  // Também remove setor colado sem hífen depois de "LTDA/SA" (ex.: Empresa Ltda Centro Cirurgico)
  name = name.replace(/\b(ltda|eireli|me|epp|s\.?a\.?)\s+(centro\s*cirurgico|cc|hemodin[âa]mica|consultas?|pareceres?|ambulatorial|visitas?|cirurgi[ao]s?|ambulat[oó]rio|uti|enfermaria|interna[cç][aã]o)\b.*$/i, "$1");
  // remove referência a período (mes/ano) em vários formatos
  name = name.replace(/\s*[-_]?\s*\d{1,2}[-_./]\d{2,4}\s*$/g, "");
  name = name.replace(/\s*[-_]?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zçé]*[\s_\-./]*\d{2,4}\s*$/i, "");
  name = name.replace(/\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*/i, "");
  name = name.replace(/\s*[-_]?\s*\d{4}\s*$/g, ""); // ano isolado no final
  // colapsa espaços
  name = name.replace(/\s+/g, " ").trim();
  return name;
};

export const matchCompany = (rawName: string, companies: CompanyRow[]): { company: CompanyRow | null; score: number } => {
  if (!companies.length || !rawName) return { company: null, score: 0 };
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

// Limites de decisão. Centralizados para manter UI e parser em sincronia.
export const MATCH_AUTO_THRESHOLD = 0.92;
export const MATCH_REVIEW_THRESHOLD = 0.75;

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
  const { company: fileMatchedCompany, score: fileMatchScore } = matchCompany(rawCompanyName, companies);
  // Quando o filename casou com alta confiança, ele é a verdade — a coluna empresa
  // da linha vira ruído (analista frequentemente preenche com hospital/cliente, não PJ).
  const filenameTrusted = fileMatchScore >= MATCH_AUTO_THRESHOLD && !!fileMatchedCompany;

  const rows: ParsedRow[] = json.map((row) => {
    const role = toStr(pick(row, ["funcao","função","papel"]));
    const repasse = toNumber(pick(row, ["vl repasse","valor repasse","valor a repassar","valor repassar","vlrepasse","vl. repasse"]));
    const procVal = toNumber(pick(row, ["valor procedimento","valor proce","vl proce","vlproce","valor convenio","valor convênio","vl convenio","vl. convenio"]));
    const grossFromAny = repasse
      || toNumber(pick(row, ["valor bruto","vlrbruto","bruto","valor"], ["repasse"]))
      || procVal;
    const procedureAmountFinal = procVal || grossFromAny || null;

    // Identificação por linha — só ativa se filename NÃO foi confiável
    const rowCompanyNameRaw = toStr(pick(row, ["empresa", "hospital", "unidade", "unidade de atendimento", "pj", "fornecedor"]));
    let rowMatchedCompany: CompanyRow | null = null;
    if (!filenameTrusted && rowCompanyNameRaw) {
      const { company: matched, score: s } = matchCompany(rowCompanyNameRaw, companies);
      if (s >= MATCH_AUTO_THRESHOLD) rowMatchedCompany = matched;
    }

    const resolvedCompany = filenameTrusted
      ? fileMatchedCompany
      : (rowMatchedCompany || fileMatchedCompany);
    const resolvedName = resolvedCompany?.name
      || (filenameTrusted ? fileMatchedCompany!.name : (rowCompanyNameRaw || rawCompanyName))
      || null;

    // Excludes: termos que indicam OUTRO papel/coluna e não devem ser confundidos.
    //   - doctor_name: "solic"/"solicitante" = quem pediu o parecer, não o prestador
    //   - date: "solic"/"emiss" = datas de solicitação/emissão, não a do procedimento
    //     (mas se nada melhor existir, ainda é melhor que vazio — só desempata)
    const DOCTOR_EXCLUDES = ["solic","solicitante","requisit","pedinte"];

    // Nome do médico: aceita variantes "Médico Parecerista", "Médico Executante",
    // "Prestador", coluna "Repasse" (em planilhas de parecer, contém o nome do
    // parecerista) — sempre evitando colunas de "solicitante".
    let doctorNameRaw = toStr(pick(row, [
      "medico parecerista","médico parecerista","parecerista",
      "medico executante","médico executante","executante",
      "medico","médico","nome","prestador",
    ], DOCTOR_EXCLUDES));
    // Fallback: planilhas de parecer usam coluna "Repasse" para o nome do
    // recebedor. Só aceitamos se NÃO for número (valores ficam em outra coluna).
    if (!doctorNameRaw) {
      const repasseCell = pick(row, ["repasse"]);
      const s = toStr(repasseCell);
      if (s && isNaN(Number(s.replace(/[\sR$.,]/g, "")))) doctorNameRaw = s;
    }

    const base = {
      doctor_name: doctorNameRaw ?? "",
      doctor_document: toStr(pick(row, ["cpf","cnpj","documento","doc"])) ?? "",
      doctor_email: toStr(pick(row, ["email","e-mail"])) ?? "",
      description: toStr(pick(row, ["procedmat","proced/mat","proced.","procedimento","descricao","descrição","servico","serviço"])) ?? "",
      gross_amount: grossFromAny,
      company_name: resolvedName,
      company_id: resolvedCompany?.id || null,
      attendance_number: toStr(pick(row, ["nr atendimento","n atendimento","atendimento","atend","nratendim"])),
      procedure_code: toStr(pick(row, ["codigo procedimento","código procedimento","codigoproc","codproc","cod. tuss","tuss"])),
      procedure_name: toStr(pick(row, ["procedmat","proced/mat","proced.","procedimento"])),
      access_route: toStr(pick(row, ["via de acesso","viaacesso","via acesso"])),
      doctor_role: role,
      agreement_text: toStr(pick(row, ["convenio","convênio","acordo","operadora","plano"])),
      specialty: toStr(pick(row, [
        "especialidade","especialid","especialidade médica","especialidade medica",
        "espec destino","espec. dest","espec dest","especialidade destino",
      ])) || null,
      procedure_amount: procedureAmountFinal,
      quantity: toNumber(pick(row, ["qtd","quantidade"])) || null,
      procedure_date: excelDateToISO(pick(row, [
        "data procedimento","data atendimento","data",
        "dt resposta","dt. resp","dt resp","data resposta",
        "dt solic","dt. solic","data solicitacao","data solicitação",
      ])),
      patient_name: toStr(pick(row, ["paciente","nome paciente","nm paciente","nome do paciente"])),
      sector: toStr(pick(row, ["setor do pagamento", "setor", "unidade de atendimento", "unidade", "departamento", "servico", "serviço", "localizacao", "localização"])),
      attendance_character: toStr(pick(row, ["tipo entrada","tipo de entrada","carater","caráter","carater atendimento","caráter atendimento","carater do atendimento","caráter do atendimento","tipo internacao","tipo internação"])),
      raw_data: row,
    };
    const tipo_linha = classifyLine(base, paymentKind || null);
    const withType = { ...base, tipo_linha };
    const line_issues = validateLine(withType);
    return { ...withType, line_issues } as ParsedRow;
  }).filter((r) => r.doctor_name || Math.abs(r.gross_amount) > 0 || r.procedure_code || r.description);

  return { file: f, rows, rawCompanyName, matchedCompany: fileMatchedCompany ? { id: fileMatchedCompany.id, name: fileMatchedCompany.name } : null, matchScore: fileMatchScore };
};
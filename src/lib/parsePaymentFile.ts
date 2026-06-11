// Parser compartilhado de arquivos Excel de base de pagamento.
// Extraído de src/pages/NewPayment.tsx para reutilização no reimport.
import * as XLSX from "xlsx";
import {
  FIELD_BY_KEY,
  inspectColumnMapping,
  type FieldKey,
  type FieldMappingHit,
  type ManualMapping,
} from "@/lib/columnMapping";
export type { ManualMapping, FieldMappingHit } from "@/lib/columnMapping";

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
  /** Headers reais detectados na linha de cabeçalho da planilha. */
  detectedHeaders: string[];
  /** Mapping campo → header efetivamente usado neste parse. */
  effectiveMapping: ManualMapping;
  /** Hits de mapping com score/confiança — alimenta o ColumnMappingDialog. */
  mappingHits: FieldMappingHit[];
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

const norm = (s: string) => (s ?? "").toString().toLowerCase().trim()
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[\s_\-./]+/g, "");

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

/**
 * Wrapper de pick que respeita um manualMapping vindo do diálogo de
 * mapeamento ou de um template salvo. Quando o campo está explicitamente
 * mapeado para um header, lemos direto desse header (mesmo que o `pick`
 * heurístico chegasse a outro resultado).
 */
const pickField = (
  row: Record<string, unknown>,
  fieldKey: FieldKey,
  manual?: ManualMapping,
): unknown => {
  if (manual && manual[fieldKey]) {
    const header = manual[fieldKey]!;
    if (header in row) return row[header];
  }
  const def = FIELD_BY_KEY[fieldKey];
  return pick(row, def.keys, def.excludes ?? []);
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
    if (d) {
      const hasTime = d.H || d.M || d.S;
      if (hasTime) {
        return new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0))).toISOString();
      }
      // Data sem hora: usar 15:00 UTC (= meio-dia em UTC-3) para evitar rollback em Brasília
      return new Date(Date.UTC(d.y, d.m - 1, d.d, 15, 0, 0)).toISOString();
    }
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh, mi] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const hasTime = hh !== undefined;
    if (hasTime) {
      return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(mi || 0))).toISOString();
    }
    return new Date(Date.UTC(year, Number(mm) - 1, Number(dd), 15, 0, 0)).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T15:00:00.000Z`;
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

// Equivalência fuzzy entre dois tokens:
//  - igualdade exata
//  - um é prefixo do outro com ambos ≥4 chars (ex.: "traumatolo" ⊂ "traumatologia")
//  - prefixo curto: shorter ≥2 chars e longer ≥5 chars (ex.: "br" ⊂ "brasilia").
//    Bloqueia preposições/artigos para evitar ruído.
//  - similaridade de Levenshtein ≥ 0.82 em tokens com ≥6 chars
//    (ex.: "lessence" ≈ "essence", "cardiororacica" ≈ "cardiotoracica").
const SHORT_PREFIX_BLOCKLIST = new Set(["de","da","do","em","no","na","os","as","ao","um","uma","com","sem","por","pra"]);
const tokensEquivalent = (x: string, y: string): boolean => {
  if (x === y) return true;
  if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 2 && l.length >= 5 && l.startsWith(s) && !SHORT_PREFIX_BLOCKLIST.has(s)) return true;
  const ml = l.length;
  if (ml >= 6) {
    const d = lev(x, y);
    if (1 - d / ml >= 0.82) return true;
  }
  return false;
};

// Jaccard fuzzy: interseção via tokensEquivalent (não só igualdade exata).
const jaccard = (a: string[], b: string[]): number => {
  if (!a.length && !b.length) return 0;
  const sa = Array.from(new Set(a));
  const sb = Array.from(new Set(b));
  const matched = new Set<number>();
  let inter = 0;
  for (const x of sa) {
    for (let i = 0; i < sb.length; i++) {
      if (matched.has(i)) continue;
      if (tokensEquivalent(x, sb[i])) { inter++; matched.add(i); break; }
    }
  }
  const union = sa.length + sb.length - inter;
  return union === 0 ? 0 : inter / union;
};

// Score híbrido: 0.65 Jaccard de tokens + 0.35 Levenshtein normalizado.
// Bônus de contenção (forte): TODOS os tokens significativos do nome curto
// cabem no longo (≥2 tokens) → score = max(score, 0.92).
// Bônus parcial (suave): cobertura ≥70% (≥3 tokens) ou ≥60% (≥2 tokens) →
// soma 0.18 / 0.10. Cobre nomes legais com partes divergentes
// ("L Essence Servicos Medicos em Cuidados da Dor" vs
//  "Lessence Norte Cuidados ao Paciente com Dor") sem inflar falsos positivos.
export const similarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const ta = tokenize(a), tb = tokenize(b);
  const j = jaccard(ta, tb);
  const l = levSim(a, b);
  let score = 0.65 * j + 0.35 * l;
  if (ta.length && tb.length) {
    const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const hits = shorter.filter((t) => longer.some((u) => tokensEquivalent(t, u))).length;
    const ratio = hits / shorter.length;
    if (ratio === 1 && shorter.length >= 2) score = Math.max(score, 0.92);
    else if (ratio >= 0.7 && shorter.length >= 3) score = Math.min(1, score + 0.18);
    else if (ratio >= 0.6 && shorter.length >= 2) score = Math.min(1, score + 0.1);
  }
  // Guarda de TOKEN DISTINTIVO: nomes incomuns (ex.: "OTOEX", "CHAIN VILLAR")
  // não podem ser auto-sugeridos para PJs cujo conteúdo significativo é totalmente
  // diferente. Se AMBOS os lados possuem um token "âncora" (≥5 chars, não-stopword)
  // e NENHUM token âncora do lado mais curto bate (mesmo fuzzy) com algum do outro
  // lado, limitamos o score abaixo do MATCH_REVIEW_THRESHOLD (0.55) para forçar
  // seleção manual em vez de empurrar um falso-positivo ao analista.
  if (ta.length && tb.length) {
    const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const shorterAnchors = shorter.filter((t) => t.length >= 5);
    const longerAnchors = longer.filter((t) => t.length >= 5);
    if (shorterAnchors.length && longerAnchors.length) {
      const anchorHit = shorterAnchors.some((t) =>
        longerAnchors.some((u) => tokensEquivalent(t, u)),
      );
      if (!anchorHit) score = Math.min(score, 0.5);
    }
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
      if (best.score >= 0.999) return best; // early exit em match exato
    }
  }
  return best;
};

// Limites de decisão. Centralizados para manter UI e parser em sincronia.
export const MATCH_AUTO_THRESHOLD = 0.92;
// Reduzido de 0.75 → 0.55: quando há um candidato razoável, preferimos pedir
// CONFIRMAÇÃO em vez de jogar o arquivo direto em "sem PJ — isolado". O
// isolamento real só ocorre quando o score é tão baixo que confirmar manualmente
// não faria sentido (provavelmente PJ nova ainda não cadastrada).
export const MATCH_REVIEW_THRESHOLD = 0.55;

// Palavras-âncora que indicam que uma linha é cabeçalho de dados de pagamento.
// Usadas para pular metadados (empresa, CNPJ, vigência, valor da NF) que
// analistas costumam empilhar nas primeiras linhas da planilha.
const HEADER_ANCHORS = [
  "medico","médico","prestador","parecerista","executante",
  "paciente","atendimento","procedimento","proced","tuss",
  "data","dt","convenio","convênio","especialidade","setor",
  "valor","repasse","bruto","pagar","quantidade","qtd","funcao","função",
];

/**
 * Localiza a linha de cabeçalho em uma planilha que pode ter metadados antes
 * (ex.: "EMPRESA: X", "VIGÊNCIA", "VALOR DA NF"). Pontuamos cada linha pela
 * quantidade de células-texto que casam com âncoras conhecidas e exigimos um
 * mínimo de 3 acertos. Se nada bater, caímos na linha 0 (comportamento legado).
 */
const detectHeaderRow = (rows: unknown[][]): number => {
  const MAX_SCAN = Math.min(rows.length, 25);
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

export interface ParseOptions {
  /** Override manual de campos → header da planilha. Vence o pick() heurístico. */
  manualMapping?: ManualMapping;
}

export const parsePaymentFile = async (
  f: File,
  companies: CompanyRow[],
  paymentKind?: string | null,
  options: ParseOptions = {},
): Promise<FileBucket> => {
  const { manualMapping } = options;
  const buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // Lê como matriz para localizar a linha de cabeçalho real — algumas
  // planilhas trazem metadados (empresa, CNPJ, vigência) antes dos dados.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  const headerIdx = detectHeaderRow(matrix);
  const headerRow = (matrix[headerIdx] || []).map((h, i) => {
    const s = (h ?? "").toString().trim();
    return s.length ? s : `__col_${i}`;
  });
  const detectedHeaders = headerRow.filter((h) => !h.startsWith("__col_"));
  const json: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] || [];
    if (row.every((c) => c == null || c === "")) continue;
    const obj: Record<string, unknown> = {};
    headerRow.forEach((key, ci) => { obj[key] = row[ci] ?? ""; });
    json.push(obj);
  }

  // Calcula mapping efetivo: heurística + override manual.
  const heuristicHits = inspectColumnMapping(detectedHeaders);
  const mappingHits: FieldMappingHit[] = heuristicHits.map((h) => {
    const override = manualMapping?.[h.field];
    if (override && detectedHeaders.includes(override)) {
      return { ...h, header: override, score: 100, confidence: "high" };
    }
    return h;
  });
  const effectiveMapping: ManualMapping = {};
  mappingHits.forEach((h) => { if (h.header) effectiveMapping[h.field] = h.header; });

  const rawCompanyName = extractCompanyFromFilename(f.name);
  const { company: fileMatchedCompany, score: fileMatchScore } = matchCompany(rawCompanyName, companies);
  const filenameTrusted = fileMatchScore >= MATCH_AUTO_THRESHOLD && !!fileMatchedCompany;

  const rows: ParsedRow[] = json.map((row) => {
    const role = toStr(pickField(row, "doctor_role", manualMapping));
    const repasse = toNumber(pickField(row, "gross_amount", manualMapping));
    const procVal = toNumber(pickField(row, "procedure_amount", manualMapping));
    // Fallback "valor bruto" só se NADA foi mapeado para gross_amount/procedure_amount
    const grossFromAny = repasse
      || (manualMapping?.gross_amount ? 0 : toNumber(pick(row, ["valor bruto","vlrbruto","bruto","valor"], ["repasse"])))
      || procVal;
    const procedureAmountFinal = procVal || grossFromAny || null;

    const rowCompanyNameRaw = toStr(pickField(row, "company_name", manualMapping));
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

    let doctorNameRaw = toStr(pickField(row, "doctor_name", manualMapping));
    // Fallback: planilhas de parecer usam coluna "Repasse" para o nome do
    // recebedor. Só aceitamos se NÃO for número (valores ficam em outra coluna).
    if (!doctorNameRaw && !manualMapping?.doctor_name) {
      const repasseCell = pick(row, ["repasse"]);
      const s = toStr(repasseCell);
      if (s && isNaN(Number(s.replace(/[\sR$.,]/g, "")))) doctorNameRaw = s;
    }

    const base = {
      doctor_name: doctorNameRaw ?? "",
      doctor_document: toStr(pickField(row, "doctor_document", manualMapping)) ?? "",
      doctor_email: toStr(pickField(row, "doctor_email", manualMapping)) ?? "",
      description: toStr(pickField(row, "description", manualMapping)) ?? "",
      gross_amount: grossFromAny,
      company_name: resolvedName,
      company_id: resolvedCompany?.id || null,
      attendance_number: toStr(pickField(row, "attendance_number", manualMapping)),
      procedure_code: toStr(pickField(row, "procedure_code", manualMapping)),
      procedure_name: toStr(pickField(row, "procedure_name", manualMapping)),
      access_route: toStr(pickField(row, "access_route", manualMapping)),
      doctor_role: role,
      agreement_text: toStr(pickField(row, "agreement_text", manualMapping)),
      specialty: toStr(pickField(row, "specialty", manualMapping)) || null,
      procedure_amount: procedureAmountFinal,
      quantity: toNumber(pickField(row, "quantity", manualMapping)) || null,
      procedure_date: excelDateToISO(pickField(row, "procedure_date", manualMapping)),
      patient_name: toStr(pickField(row, "patient_name", manualMapping)),
      sector: toStr(pickField(row, "sector", manualMapping)),
      attendance_character: toStr(pickField(row, "attendance_character", manualMapping)),
      raw_data: row,
    };
    const tipo_linha = classifyLine(base, paymentKind || null);
    const withType = { ...base, tipo_linha };
    const line_issues = validateLine(withType);
    return { ...withType, line_issues } as ParsedRow;
  }).filter((r) => r.doctor_name || Math.abs(r.gross_amount) > 0 || r.procedure_code || r.description);

  return {
    file: f,
    rows,
    rawCompanyName,
    matchedCompany: fileMatchedCompany ? { id: fileMatchedCompany.id, name: fileMatchedCompany.name } : null,
    matchScore: fileMatchScore,
    detectedHeaders,
    effectiveMapping,
    mappingHits,
  };
};

/**
 * Lê apenas o cabeçalho da planilha (sem parsear linhas). Usado pelo
 * diálogo de mapeamento para pré-aplicar template salvo antes do parse real.
 */
export const inspectFileHeaders = async (
  f: File,
): Promise<{ headers: string[]; sampleRow: Record<string, unknown> | null }> => {
  const buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  const headerIdx = detectHeaderRow(matrix);
  const headerRow = (matrix[headerIdx] || []).map((h, i) => {
    const s = (h ?? "").toString().trim();
    return s.length ? s : `__col_${i}`;
  });
  const headers = headerRow.filter((h) => !h.startsWith("__col_"));
  const sampleArr = matrix[headerIdx + 1] || [];
  const sampleRow: Record<string, unknown> = {};
  headerRow.forEach((k, i) => { sampleRow[k] = sampleArr[i] ?? ""; });
  return { headers, sampleRow };
};
};
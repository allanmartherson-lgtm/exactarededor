// Parser compartilhado de arquivos Excel de base de pagamento.
// Extraído de src/pages/NewPayment.tsx para reutilização no reimport.
import * as XLSX from "xlsx";
import {
  applyManualMappingShim,
  FIELD_BY_KEY,
  inspectColumnMapping,
  type FieldKey,
  type FieldMappingHit,
  type ManualMapping,
} from "@/lib/columnMapping";
import { normalizeAccessRouteForImport } from "@/lib/normAccessRoute";
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
  /** true se a hora foi extraída explicitamente da base hospitalar. */
  procedure_date_has_time?: boolean;
  patient_name: string | null;
  sector: string | null;
  /** Caráter do atendimento (ELETIVO / URGENCIA / EMERGENCIA) — usado pelo motor para filtros de bônus. */
  attendance_character: string | null;
  raw_data: Record<string, unknown>;
  tipo_linha: LineType;
  line_issues: LineIssue[];
  /** Override de item_type aplicado pelo parser (ex.: lote Consulta com TUSS
   * que não bate com consulta.tuss_default/extras → reclassifica para
   * Procedimento). Consumido por NewPayment/PaymentDetail ao montar
   * payment_items.item_type_id. */
  payment_type_id_override?: string | null;
  /** true quando a coluna de repasse (gross_amount) foi explicitamente
   *  mapeada/encontrada na planilha — mesmo que o valor seja 0. Permite
   *  diferenciar "0 legítimo" (ex.: Retorno) de "valor ausente". */
  gross_explicit?: boolean;
}


export interface CompanyRow { id: string; name: string; aliases: string[]; document?: string | null }

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

// Termos de classificação por palavra-chave. Cada um deve ser matchável como
// PALAVRA INTEIRA (\b) no texto da coluna correta — substring solta gera
// falso-positivo (ex.: nome TUSS "Costectomia ... Cada Arco Adicional" não é
// "complemento_bonus").
const COMPLEMENTO_TERMS = ["bonus","bônus","complemento","adicional","diferenca","diferença","produtividade","incentivo","valor complementar","ajuste de valor","complemento pacote","complemento cirurgico","complemento cirúrgico"];
const GLOSA_TERMS = ["glosa","desconto","abatimento","devolução","devolucao","estorno","ajuste negativo"];
const REPROC_TERMS = ["retroativo","pendência","pendencia","competência anterior","competencia anterior","ajuste mês anterior","ajuste mes anterior"];
const PACOTE_TERMS = ["pacote"];
const VISITA_TERMS = ["visita"];
const PARECER_TERMS = ["parecer"];
const CIRURGIA_TERMS = ["cirurgia","cirurg","procedimento"];

/**
 * Headers que carregam o TIPO explícito do item, vindos da base já tratada
 * pelo analista. NÃO inclui "tipo atendimento" / "tipo entrada" / "tipo
 * internacao" — esses representam ELETIVO/URGENCIA, não parecer/visita.
 */
const EXPLICIT_TYPE_HEADERS = ["tipo", "tipo item", "tipo do item", "categoria", "tipo linha", "tipo de linha"];
const normHeader = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const EXPLICIT_TYPE_VALUES: Record<string, LineType> = {
  parecer: "parecer",
  visita: "visita",
  pacote: "pacote",
  procedimento: "procedimento",
  cirurgia: "procedimento",
  glosa: "glosa_desconto",
  desconto: "glosa_desconto",
  bonus: "complemento_bonus",
  complemento: "complemento_bonus",
};
/**
 * Quando a base já vem com uma coluna TIPO marcando parecer/visita/etc., usa
 * esse valor como autoridade — o analista já fez a classificação manualmente
 * (ex.: cardiologia mistura visita + parecer no mesmo arquivo).
 */
function extractExplicitItemType(row: Record<string, unknown>): LineType | null {
  for (const [k, v] of Object.entries(row)) {
    if (!EXPLICIT_TYPE_HEADERS.includes(normHeader(String(k)))) continue;
    const nv = normHeader(String(v ?? ""));
    if (EXPLICIT_TYPE_VALUES[nv]) return EXPLICIT_TYPE_VALUES[nv];
  }
  return null;
}

const stripDiacriticsLower = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Match por palavra inteira (fronteira \b), case/acento-insensível. */
const containsWord = (txt: string, terms: string[]) => {
  const t = stripDiacriticsLower(txt);
  return terms.some((w) => {
    const norm = stripDiacriticsLower(w);
    // \b não funciona para "ç"/acentos, mas como já stripamos, vale.
    const re = new RegExp(`(^|[^a-z0-9])${norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    return re.test(t);
  });
};

/** Match por substring solta (mantido para termos curtos como "pacote"/"visita"). */
const containsAny = (txt: string, terms: string[]) => {
  const t = stripDiacriticsLower(txt);
  return terms.some((w) => t.includes(stripDiacriticsLower(w)));
};

/**
 * Classifica o tipo de linha da planilha. Ordem de precedência:
 *  1. glosa_desconto: valor negativo OU termo de glosa.
 *  2. complemento_bonus: termo de complemento APENAS quando:
 *      - NÃO há `procedure_code` (TUSS) válido — procedimento real não é bônus, E
 *      - o termo aparece em `description` ou `doctor_role` (colunas livres) —
 *        NUNCA no `procedure_name` (nome TUSS oficial pode conter "adicional",
 *        "complemento", etc.).
 *  3. reprocessamento: pendência declarada ou termo retroativo.
 *  4. pacote / visita / parecer / procedimento / outro.
 */
export const classifyLine = (
  r: Omit<ParsedRow, "tipo_linha" | "line_issues">,
  paymentKind?: string | null,
): LineType => {
  const blob = `${r.description ?? ""} ${r.procedure_name ?? ""} ${r.doctor_role ?? ""}`;
  if (containsAny(blob, GLOSA_TERMS) || (r.gross_amount ?? 0) < 0) return "glosa_desconto";

  // Complemento/bônus exige (a) ausência de TUSS E (b) termo fora do nome TUSS.
  const hasTuss = !!(r.procedure_code && String(r.procedure_code).trim());
  const freeText = `${r.description ?? ""} ${r.doctor_role ?? ""}`;
  if (!hasTuss && containsWord(freeText, COMPLEMENTO_TERMS)) return "complemento_bonus";

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
  // 0 explícito (coluna de repasse mapeada/canônica com valor 0 — ex.: Retorno
  // não pago) NÃO conta como "valor ausente" e não bloqueia.
  const hasValue = Math.abs(r.gross_amount ?? 0) > 0 || !!r.gross_explicit;
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
      // Valor zerado é permitido (parecer/visita não pago precisa ficar zerado
      // para justificar). Mantemos como alerta visível, não bloqueante.
      if (!hasValue) issues.push({ severity: "alerta", field: "gross_amount", message: "Valor zerado — confirme se é parecer/visita não pago (justifique no campo de observação)" });
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
  if (manual && Object.prototype.hasOwnProperty.call(manual, fieldKey)) {
    const header = manual[fieldKey]!;
    if (header in row) return row[header];
    return undefined;
  }
  const def = FIELD_BY_KEY[fieldKey];
  return pick(row, def.keys, def.excludes ?? []);
};

const hasManualField = (manual: ManualMapping | undefined, fieldKey: FieldKey): boolean =>
  !!manual && Object.prototype.hasOwnProperty.call(manual, fieldKey);

const toNumber = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[R$\s]/g, "").replace(/\.(?=\d{3}(?:[,.]|$))/g, "").replace(",", ".");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
};

/**
 * Lê o workbook preservando texto quando o arquivo é TSV/CSV/HTML disfarçado
 * de .xls (comum em exports do Tasy). Se o SheetJS parsear "326,06" como número,
 * ele aplica convenção en-US (vírgula = milhar) e produz 32606 — bug crítico
 * de importação. Detectamos formatos texto pelo magic byte e reparseamos com
 * todas as células como string, deixando o toNumber (pt-BR) fazer o cast.
 */
export const readWorkbookPreservingText = (buf: ArrayBuffer, opts: XLSX.ParsingOptions): XLSX.WorkBook => {
  const bytes = new Uint8Array(buf);
  const isOle = bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0;
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4B && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  if (isOle || isZip) return XLSX.read(buf, opts);

  // Arquivo texto disfarçado. Decodifica (tenta UTF-8, cai para latin1) e
  // detecta delimitador olhando a primeira linha não-vazia.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("latin1").decode(buf);
  }
  const stripped = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const firstLine = stripped.split("\n").find((l) => l.trim().length > 0) ?? "";
  const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuote) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuote = false; }
        else cur += ch;
      } else if (ch === '"') {
        inQuote = true;
      } else if (ch === delim) {
        out.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const aoa: string[][] = stripped.split("\n").filter((l) => l.length > 0).map(parseLine);
  const sheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });
  // aoa_to_sheet auto-detecta números — forçar string em todas as células.
  for (const addr of Object.keys(sheet)) {
    if (addr.startsWith("!")) continue;
    const cell = (sheet as Record<string, XLSX.CellObject>)[addr];
    if (cell && cell.v != null) {
      cell.t = "s";
      cell.v = String(cell.v);
      delete cell.w;
    }
  }
  const wb: XLSX.WorkBook = { SheetNames: ["Sheet1"], Sheets: { Sheet1: sheet } };
  return wb;
};

/**
 * SheetJS, ao ler TSV/CSV disfarçado de XLS sem `raw:true`, converte moeda BR
 * de forma irreversível: "326,06" vira 32606 e "1.086,883125" vira 1.086883125.
 * Quando recebemos células numéricas com `w` preservando o texto original,
 * restauramos `v` para esse texto antes de montar a matriz; depois o parser
 * canônico pt-BR faz a conversão correta.
 */
export const preserveFormattedBrazilianNumbers = (sheet: XLSX.WorkSheet): void => {
  for (const addr of Object.keys(sheet)) {
    if (addr.startsWith("!")) continue;
    const cell = (sheet as Record<string, XLSX.CellObject>)[addr];
    if (!cell || cell.t !== "n" || typeof cell.w !== "string") continue;
    const formatted = cell.w.trim();
    if (!/^[-+]?\d{1,3}(?:\.\d{3})*,\d+$/.test(formatted) && !/^[-+]?\d+,\d+$/.test(formatted)) continue;
    cell.t = "s";
    cell.v = formatted;
  }
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
const excelSerialToParts = (
  serial: number,
): { y: number; m: number; d: number; H: number; M: number; S: number; hasTime: boolean } | null => {
  if (!isFinite(serial) || serial <= 0) return null;
  // Excel serial date (1900 system, com bug do 29/02/1900 — usar 25569 = 1970-01-01)
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  if (isNaN(+dt)) return null;
  const frac = serial - Math.floor(serial);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    H: dt.getUTCHours(),
    M: dt.getUTCMinutes(),
    S: dt.getUTCSeconds(),
    hasTime: frac > 1e-6,
  };
};

/**
 * Formata data-only como `YYYY-MM-DDT12:00:00.000Z`. Meio-dia UTC garante
 * que a data-calendário seja idêntica em qualquer fuso de -11h a +11h,
 * evitando que "15/03" salvo vire "14/03" ao ser exibido em BRT (-03).
 */
const dateOnlyIso = (y: number, m: number, d: number): string => {
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}T12:00:00.000Z`;
};

export const excelDateToISOWithFlag = (v: unknown): { iso: string | null; hasTime: boolean } => {
  if (v == null || v === "") return { iso: null, hasTime: false };
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return { iso: null, hasTime: false };
    const hasTime = v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() > 0;
    if (hasTime) return { iso: v.toISOString(), hasTime: true };
    // Data-only: normaliza para meio-dia UTC para evitar deslocamento por timezone.
    return { iso: dateOnlyIso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()), hasTime: false };
  }
  if (typeof v === "number") {
    // Tenta usar XLSX.SSF se disponível; senão, conversor próprio.
    const ssf = (XLSX as unknown as { SSF?: { parse_date_code?: (n: number) => any } }).SSF;
    const d = ssf?.parse_date_code?.(v) ?? excelSerialToParts(v);
    if (d) {
      const hasTime = !!(d.H || d.M || d.S);
      if (hasTime) {
        return {
          iso: new Date(Date.UTC(d.y, d.m - 1, d.d, d.H || 0, d.M || 0, Math.floor(d.S || 0))).toISOString(),
          hasTime: true,
        };
      }
      return { iso: dateOnlyIso(d.y, d.m, d.d), hasTime: false };
    }
  }

  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh, mi] = m;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    const hasTime = hh !== undefined;
    if (hasTime) {
      return { iso: new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(mi || 0))).toISOString(), hasTime: true };
    }
    return { iso: dateOnlyIso(year, Number(mm), Number(dd)), hasTime: false };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yy, mm, dd] = s.split("-").map(Number);
    return { iso: dateOnlyIso(yy, mm, dd), hasTime: false };
  }
  // String puramente numérica em coluna de data = serial Excel (comum após
  // readWorkbookPreservingText forçar tudo para string). Reprocessa como número
  // para evitar new Date("46165") virar ano 46165.
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && n > 0 && n < 200000) {
      const parts = excelSerialToParts(n);
      if (parts) {
        return { iso: dateOnlyIso(parts.y, parts.m, parts.d), hasTime: false };
      }
    }
    return { iso: null, hasTime: false };
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return { iso: null, hasTime: false };
  // Rejeita datas fora de um intervalo plausível (evita ISO estendido com
  // ano de 6 dígitos que o Postgres rejeita: "time zone displacement out of range").
  const y = d.getUTCFullYear();
  if (y < 1970 || y > 2100) return { iso: null, hasTime: false };
  const hasTime = /T\d{2}:\d{2}/.test(s) && !/T00:00(?::00)?(?:\.000)?Z?$/.test(s);
  if (!hasTime) return { iso: dateOnlyIso(y, d.getUTCMonth() + 1, d.getUTCDate()), hasTime: false };
  return { iso: d.toISOString(), hasTime: true };
};

const excelDateToISO = (v: unknown): string | null => excelDateToISOWithFlag(v).iso;

/**
 * A planilha de Parecer/Visita às vezes não tem coluna "Descrição" real e a
 * heurística acaba pegando uma coluna de data — o valor cru é o serial do
 * Excel (ex.: 46091.49585648148). Convertemos para dd/mm/yyyy [hh:mm] para
 * não exibir lixo numérico ao analista. Strings comuns passam intactas.
 */
const looksLikeExcelDateSerial = (v: unknown): boolean => {
  const n = typeof v === "number"
    ? v
    : (typeof v === "string" && /^\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN);
  return Number.isFinite(n) && n > 30000 && n < 80000;
};

const sanitizeDescription = (raw: unknown): string | null => {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date || looksLikeExcelDateSerial(raw)) {
    const { iso, hasTime } = excelDateToISOWithFlag(raw);
    if (iso) {
      const d = new Date(iso);
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const yyyy = d.getUTCFullYear();
      if (hasTime) {
        const HH = String(d.getUTCHours()).padStart(2, "0");
        const MI = String(d.getUTCMinutes()).padStart(2, "0");
        return `${dd}/${mm}/${yyyy} ${HH}:${MI}`;
      }
      return `${dd}/${mm}/${yyyy}`;
    }
  }
  return toStr(raw);
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
  "medicos","médicos","medicas","médicas","hospitais","clinicas","clínicas","institutos","centros",
  "consultorio","consultório","de","da","do","das","dos","e","&","cia","grupo","unidade",
  "ltd","comercio","comércio","empresarial","cnpj",
]);

// Termos clínicos/administrativos genéricos que aparecem em MUITAS PJs diferentes
// (especialidades, público-alvo, tipos de serviço). Passam pelo tokenizer porque têm
// ≥5 chars, mas não podem valer como "token de marca" — se forem os ÚNICOS pontos de
// contato entre dois nomes, o match é falso-positivo (ex.: "REVITALITE MULHER" vs
// "CLINICA DA MULHER GINECOLOGIA OBSTETRICIA" batia 92% só via mulher/ginecologia/obstetricia).
// Mantém stopwords tradicionais em STOPWORDS acima; aqui vai o que é específico do domínio médico.
const DOMAIN_GENERIC = new Set([
  "mulher","mulheres","homem","homens","adulto","adultos","infantil","infantis","crianca","criancas",
  "feminina","feminino","masculina","masculino","geral","especializada","especializado","especialidade",
  "assistencia","assistencial","atendimento","atendimentos","cuidados","cuidado",
  "diagnostico","diagnosticos","imagem","imagens","laboratorio","laboratorios",
  "reabilitacao","fisioterapia","psicologia","nutricao","estetica",
  "ginecologia","ginecologica","ginecologico","obstetricia","obstetrica","obstetrico",
  "cardiologia","cardiologica","ortopedia","ortopedica","pediatria","pediatrica",
  "dermatologia","dermatologica","urologia","urologica","neurologia","neurologica",
  "oncologia","oncologica","radiologia","radiologica","anestesia","anestesiologia",
  "cirurgia","cirurgica","cirurgias","endocrinologia","gastroenterologia","otorrino",
  "otorrinolaringologia","oftalmologia","oftalmologica","reumatologia","nefrologia",
  "pneumologia","psiquiatria","hematologia","infectologia","mastologia","proctologia",
  "vascular","vasculares","plastica","plasticas","bucomaxilo","bariatrica","bariatria",
  "parecer","pareceres","visita","visitas","consulta","consultas","ambulatorio","ambulatorial",
  "internacao","enfermaria","uti","emergencia","urgencia","pronto","socorro","hemodinamica",
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
  // Tokens "de marca" = removem stopwords jurídicas E termos clínicos genéricos.
  // Só eles servem para diferenciar PJs (ex.: "REVITALITE", "ZAHO", "OTOEX").
  const brandA = ta.filter((t) => !DOMAIN_GENERIC.has(t));
  const brandB = tb.filter((t) => !DOMAIN_GENERIC.has(t));
  if (ta.length && tb.length) {
    const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const hits = shorter.filter((t) => longer.some((u) => tokensEquivalent(t, u))).length;
    const ratio = hits / shorter.length;
    // Bônus de containment/cobertura só faz sentido se pelo menos UM token de marca
    // do lado mais curto participou do match. Sem isso, o "containment" é 100%
    // genérico (todos os tokens comuns são clínicos) e infla falsos-positivos
    // como "CLINICA DA MULHER GINECOLOGIA OBSTETRICIA" ↔ "REVITALITE MULHER ...".
    const shorterBrand = shorter.filter((t) => !DOMAIN_GENERIC.has(t));
    const longerBrand = longer.filter((t) => !DOMAIN_GENERIC.has(t));
    const brandHit = shorterBrand.length === 0
      ? false
      : shorterBrand.some((t) => longerBrand.some((u) => tokensEquivalent(t, u)));
    if (brandHit) {
      if (ratio === 1 && shorter.length >= 2) score = Math.max(score, 0.92);
      else if (ratio >= 0.7 && shorter.length >= 3) score = Math.min(1, score + 0.18);
      else if (ratio >= 0.6 && shorter.length >= 2) score = Math.min(1, score + 0.1);
    }
  }
  // Guarda de TOKEN DE MARCA: se ambos os lados têm tokens de marca (≥5 chars
  // e fora de DOMAIN_GENERIC) mas NENHUM bate fuzzy, cap abaixo do
  // MATCH_REVIEW_THRESHOLD (0.55) para forçar seleção manual. Cobre o caso em
  // que sufixos idênticos ("SERVICOS MEDICOS LTDA") inflam o levSim entre
  // marcas totalmente distintas (ex.: "ZAHO" vs "B A S").
  const brandAnchorsA = brandA.filter((t) => t.length >= 4);
  const brandAnchorsB = brandB.filter((t) => t.length >= 4);
  
  if (brandAnchorsA.length && brandAnchorsB.length) {
    const brandAnchorHit = brandAnchorsA.some((t) =>
      brandAnchorsB.some((u) => tokensEquivalent(t, u)),
    );
    if (!brandAnchorHit) score = Math.min(score, 0.5);
  } else if (brandAnchorsA.length || brandAnchorsB.length) {
    // Um lado tem marca, o outro não tem NENHUMA marca comparável (só genéricos
    // ou tokens curtos, ex.: "B A S"). Sem forma de validar a marca → cap 0.5.
    score = Math.min(score, 0.5);
  } else if (ta.length === 0 || tb.length === 0) {
    // Sequer há tokens de conteúdo em um dos lados após stopwords: não dá para
    // afirmar similaridade — evita 0.9 vindo apenas de sufixos jurídicos.
    score = Math.min(score, 0.5);
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
  // Limpa rawName de sufixos de setor/período (vindos do nome do arquivo). Sem isso,
  // dois arquivos com o MESMO sufixo (ex.: "- Parecer Adulto") casam 100% nesse sufixo
  // via aliases contaminados — gera falso positivo absurdo (SINUS sugerindo R E I).
  const rawClean = extractCompanyFromFilename(rawName);
  let best: { company: CompanyRow | null; score: number } = { company: null, score: 0 };
  for (const c of companies) {
    const candidates = [c.name, ...(c.aliases || [])];
    for (const cand of candidates) {
      // SEMPRE comparar versões limpas dos dois lados. Comparar versões "raw"
      // permite que aliases contaminados com sufixos comuns (ex.: "- Parecer Adulto",
      // "- Centro Cirurgico") batam 92% entre arquivos DIFERENTES só porque
      // compartilham o mesmo sufixo de setor — gerando falso-positivo cruzado
      // (ex.: "SILVESTRINI ... - Parecer Adulto" sugerido como "R E I ..." porque
      // ambos têm alias terminando em "- Parecer Adulto"). extractCompanyFromFilename
      // é idempotente para nomes já limpos, então não regride matches legítimos.
      const candClean = extractCompanyFromFilename(cand);
      const rawCleanForCand = extractCompanyFromFilename(rawName);
      const s = similarity(rawCleanForCand || rawName, candClean || cand);
      if (s > best.score) best = { company: c, score: s };
      if (best.score >= 0.999) return best; // early exit em match exato
    }
  }

  return best;
};

// Limites de decisão. Centralizados para manter UI e parser em sincronia.
// IMPORTANTE: auto-match APENAS quando 100% (nome exato ou alias exato após
// normalização). Match fuzzy (mesmo em ~90%) já gerou falsos-positivos em
// produção — analista relatou que "muitos 90% não batiam". Qualquer coisa
// abaixo de 1.0 entra em revisão manual; abaixo de 0.90 NÃO exibe sugestão
// (arquivo fica em stand-by como "sem PJ" — evita vínculo silencioso errado).
export const MATCH_AUTO_THRESHOLD = 1.0;
export const MATCH_REVIEW_THRESHOLD = 0.9;
// Piso para permitir que o analista aceite a sugestão automática do sistema.
// Alinhado ao REVIEW_THRESHOLD: se aparece sugestão, é sempre confirmável;
// abaixo disso não há sugestão nenhuma.
export const MATCH_CONFIRM_MIN = 0.9;

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
  /**
   * Metadados do tipo de pagamento — quando o tipo (parecer/visita/plantão fixo)
   * traz TUSS e/ou função padrão, aplicamos esses defaults nas linhas
   * sem código/função na planilha. MESMA semântica do NewPayment (importação
   * inicial), garantindo paridade entre import e reimport.
   */
  paymentTypeMeta?: {
    code?: string | null;
    label?: string | null;
    tuss_default?: string | null;
    requires_tuss_in_sheet?: boolean;
    default_function?: string | null;
    /** Códigos TUSS extras aceitos como "ainda é Consulta" (além do tuss_default). */
    tuss_codes_extra?: string[] | null;
    /** item_types.id para onde reclassificar quando o lote é Consulta e o
     * TUSS da planilha não casa com {tuss_default} ∪ tuss_codes_extra.
     * Tipicamente o id de "Procedimento". */
    dynamic_fallback_item_type_id?: string | null;
  } | null;
}


const PARECER_RESPONSE_DATE_KEYS = [
  "dt resposta parecer", "dt. resposta parecer", "data resposta parecer",
  "dt resp parecer", "dt. resp. parecer", "dt resp par", "dt. resp. par.", "dt. resp. par", "dtresppar",
  "dt resposta", "dt. resp", "dt resp", "data resposta",
];

const looksLikeSolicitationDateHeader = (header: string | null | undefined): boolean => {
  if (!header) return false;
  const n = norm(header);
  return n.includes("dtsolic") || n.includes("datasolic") || n.includes("solicitacao") || n.includes("solicit");
};

const isParecerPaymentType = (meta: ParseOptions["paymentTypeMeta"]): boolean => {
  const text = `${meta?.code ?? ""} ${meta?.label ?? ""}`;
  return /parecer/i.test(text.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
};

/**
 * Resolve fórmulas Excel simples cujo valor cached está ausente.
 * Suporta apenas operadores +, -, *, / com operandos = número literal ou
 * referência A1 da MESMA aba. Qualquer coisa fora disso é ignorada (mantém
 * o comportamento atual de devolver vazio + alerta).
 */
export function resolveSimpleFormulas(sheet: Record<string, any>): void {
  const ref = sheet["!ref"];
  if (!ref) return;
  const SAFE = /^[\s+\-*/().0-9A-Z$]+$/i; // só refs + números + operadores
  const REF_RE = /\$?([A-Z]+)\$?(\d+)/gi;
  const resolveCell = (addr: string): number | null => {
    const c = sheet[addr.replace(/\$/g, "").toUpperCase()];
    if (!c) return null;
    if (typeof c.v === "number") return c.v;
    if (typeof c.v === "string") {
      const s = c.v.replace(/\./g, "").replace(",", ".");
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  for (const addr of Object.keys(sheet)) {
    if (addr.startsWith("!")) continue;
    const cell = sheet[addr];
    if (!cell || !cell.f) continue;
    if (cell.v !== undefined && cell.v !== null && cell.v !== "") continue;
    const formula = String(cell.f).trim().replace(/^=/, "");
    if (!SAFE.test(formula)) continue;
    let bad = false;
    const replaced = formula.replace(REF_RE, (_, col: string, rowStr: string) => {
      const v = resolveCell(`${col.toUpperCase()}${rowStr}`);
      if (v == null) { bad = true; return "0"; }
      return `(${v})`;
    });
    if (bad) continue;
    try {
      // eslint-disable-next-line no-new-func
      const val = Function(`"use strict";return (${replaced});`)();
      if (typeof val === "number" && Number.isFinite(val)) {
        cell.v = val;
        cell.t = "n";
      }
    } catch { /* ignora */ }
  }
}


export const parsePaymentFile = async (
  f: File,
  companies: CompanyRow[],
  paymentKind?: string | null,
  options: ParseOptions = {},
): Promise<FileBucket> => {
  const { manualMapping, paymentTypeMeta } = options;

  const buf = await f.arrayBuffer();
  const wb = readWorkbookPreservingText(buf, { cellDates: false, cellFormula: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  preserveFormattedBrazilianNumbers(sheet);
  // Resolve fórmulas simples (=A1*B1, =A1*0.7, +, -, /) cujo valor cached não
  // foi salvo no arquivo — acontece quando o Excel/LibreOffice grava sem
  // recalcular. Sem isso, "Vl a Repassar" computado como =N3*O3 chega vazio
  // no parser, gerando falso "Valor obrigatório (gross_amount)".
  resolveSimpleFormulas(sheet);
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
  const filenameTrusted = shouldTrustFilenameCompany(fileMatchScore, fileMatchedCompany, json, effectiveMapping);

  const rows: ParsedRow[] = json.map((row) => {
    const procedureDateValue = (() => {
      const mappedDateHeader = manualMapping?.procedure_date;
      if (mappedDateHeader && mappedDateHeader in row) {
        if (isParecerPaymentType(paymentTypeMeta) && looksLikeSolicitationDateHeader(mappedDateHeader)) {
          return undefined;
        }
        return row[mappedDateHeader];
      }
      if (isParecerPaymentType(paymentTypeMeta)) {
        return pick(row, PARECER_RESPONSE_DATE_KEYS);
      }
      return pickField(row, "procedure_date", manualMapping);
    })();
    const role = toStr(pickField(row, "doctor_role", manualMapping));
    const repasseRaw = pickField(row, "gross_amount", manualMapping);
    const procValRaw = pickField(row, "procedure_amount", manualMapping);
    const repasse = toNumber(repasseRaw);
    const procVal = toNumber(procValRaw);
    const grossSourceAuthoritative = hasManualField(manualMapping, "gross_amount") || repasseRaw !== undefined;
    const procSourceAuthoritative = hasManualField(manualMapping, "procedure_amount") || procValRaw !== undefined;
    const genericValue = toNumber(pick(row, ["valor bruto","vlrbruto","bruto","valor"], ["repasse"]));
    // Repasse manual/canônico é autoritativo mesmo quando o valor é 0/vazio.
    const grossFromAny = grossSourceAuthoritative
      ? repasse
      : (repasse || genericValue || procVal);
    // Base do procedimento também preserva 0 quando mapeada/canônica; caso contrário,
    // ainda pode usar o valor genérico da planilha como base de cálculo.
    const procedureAmountFinal = procSourceAuthoritative
      ? procVal
      : (procVal || genericValue || grossFromAny || null);

    // === INVARIANTE INTERNO (NÃO REMOVER) ===
    // Quando o analista mapeia manualmente uma coluna de valor (repasse ou
    // base de procedimento), o valor final DEVE ser exatamente o que está
    // naquela célula — mesmo se for 0, vazio, negativo ou inválido.
    // Heurísticas, fallback para "Valor Tot"/"Valor"/aliases canônicos e
    // cruzamento com outro campo são PROIBIDOS nesse caso. Esta guarda existe
    // para garantir que regressões futuras no pipeline de pick/heurística
    // não voltem a inflar lotes silenciosamente (caso MATERNAL: 24 itens
    // com Vl a Repassar=0 sobrescritos por Valor Tot=95).
    if (hasManualField(manualMapping, "gross_amount")) {
      const manualHeader = manualMapping!.gross_amount!;
      const expected = toNumber(row[manualHeader]);
      if (grossFromAny !== expected) {
        throw new Error(
          `[parsePaymentFile] Invariante violado: mapeamento manual de gross_amount → "${manualHeader}" ` +
          `deveria resultar em ${expected} (valor cru: ${JSON.stringify(row[manualHeader])}), ` +
          `mas o pipeline produziu ${grossFromAny}. Heurística ou fallback indevido foi acionado.`
        );
      }
    }
    if (hasManualField(manualMapping, "procedure_amount")) {
      const manualHeader = manualMapping!.procedure_amount!;
      const expected = toNumber(row[manualHeader]);
      if (procedureAmountFinal !== expected) {
        throw new Error(
          `[parsePaymentFile] Invariante violado: mapeamento manual de procedure_amount → "${manualHeader}" ` +
          `deveria resultar em ${expected} (valor cru: ${JSON.stringify(row[manualHeader])}), ` +
          `mas o pipeline produziu ${procedureAmountFinal}. Heurística ou fallback indevido foi acionado.`
        );
      }
    }


    const rowCompanyNameRaw = readRowCompanyName(row, manualMapping);
    let rowMatchedCompany: CompanyRow | null = null;
    if (!filenameTrusted && rowCompanyNameRaw) {
      const { company: matched, score: s } = matchCompany(rowCompanyNameRaw, companies);
      if (s >= MATCH_AUTO_THRESHOLD) rowMatchedCompany = matched;
    }

    // Só grava company_id quando temos identificação CONFIÁVEL (score >= AUTO_THRESHOLD),
    // seja pelo nome do arquivo (filenameTrusted) ou por match exato da coluna EMPRESA da linha.
    // NUNCA usar fileMatchedCompany como fallback quando filenameTrusted=false —
    // isso vinculava PJ com baixa confiança silenciosamente (ex.: Cliego → UNICA a 50%),
    // e o analista não conseguia colocar o lote em standby para conferir.
    const resolvedCompany = filenameTrusted
      ? fileMatchedCompany
      : (rowCompanyNameRaw ? rowMatchedCompany : null);
    // Preserva o nome cru pra exibição (raw_company_name em unmatched / diagnóstico),
    // mesmo quando não gravamos id — analista precisa ver o que veio da planilha.
    const resolvedName = resolvedCompany?.name
      || rowCompanyNameRaw
      || rawCompanyName
      || null;

    let doctorNameRaw = toStr(pickField(row, "doctor_name", manualMapping));
    // Fallback: planilhas de parecer usam coluna "Repasse" para o nome do
    // recebedor. Só aceitamos se NÃO for número (valores ficam em outra coluna).
    if (!doctorNameRaw && !manualMapping?.doctor_name) {
      const repasseCell = pick(row, ["repasse"]);
      const s = toStr(repasseCell);
      if (s && isNaN(Number(s.replace(/[\sR$.,]/g, "")))) doctorNameRaw = s;
    }

    const rawAccessRoute = toStr(pickField(row, "access_route", manualMapping));
    const accessRouteNorm = normalizeAccessRouteForImport(rawAccessRoute);

    const base = {
      doctor_name: doctorNameRaw ?? "",
      doctor_document: toStr(pickField(row, "doctor_document", manualMapping)) ?? "",
      doctor_email: toStr(pickField(row, "doctor_email", manualMapping)) ?? "",
      description: sanitizeDescription(pickField(row, "description", manualMapping)) ?? "",
      gross_amount: grossFromAny,
      gross_explicit: grossSourceAuthoritative,
      company_name: resolvedName,
      company_id: resolvedCompany?.id || null,
      attendance_number: toStr(pickField(row, "attendance_number", manualMapping)),
      procedure_code: toStr(pickField(row, "procedure_code", manualMapping)),
      procedure_name: toStr(pickField(row, "procedure_name", manualMapping)),
      access_route: accessRouteNorm.canonical,
      doctor_role: role,
      agreement_text: toStr(pickField(row, "agreement_text", manualMapping)),
      specialty: toStr(pickField(row, "specialty", manualMapping)) || null,
      procedure_amount: procedureAmountFinal,
      quantity: toNumber(pickField(row, "quantity", manualMapping)) || null,
      ...(() => {
        const p = excelDateToISOWithFlag(procedureDateValue);
        return { procedure_date: p.iso, procedure_date_has_time: p.hasTime };
      })(),
      patient_name: toStr(pickField(row, "patient_name", manualMapping)),
      sector: toStr(pickField(row, "sector", manualMapping)),
      attendance_character: toStr(pickField(row, "attendance_character", manualMapping)),
      raw_data: {
        ...row,
        ...(accessRouteNorm.raw ? { __via_acesso_original: accessRouteNorm.raw } : {}),
      },
    };

    // === Injeção de defaults do tipo de pagamento ===
    // Espelho exato do que NewPayment.tsx aplica na importação inicial:
    //  - tuss_default → preenche/sobrescreve procedure_code; quando o procedimento
    //    é fixo (parecer/visita/consulta), procedure_name vira "{label} - {Espec dest}";
    //  - default_function → preenche doctor_role vazio (ex.: "Parecerista");
    //  - tipos por evento (que injetam função padrão) não têm dimensão de setor —
    //    a coluna de setor é zerada para o lookup estrito não tentar resolver.
    let payment_type_id_override: string | null = null;
    if (paymentTypeMeta) {
      const procFixed =
        !!paymentTypeMeta.tuss_default || paymentTypeMeta.requires_tuss_in_sheet === false;
      // Regra híbrida (aplicada primeiro a CONSULTA): se a planilha trouxer
      // procedure_code/procedure_name, ela prevalece; caso contrário, o sistema
      // imputa o default do tipo. Parecer/Visita seguem o comportamento antigo
      // (sempre sobrescreve) até decidirmos migrá-los também.
      const labelLower = (paymentTypeMeta.label || "").toLowerCase();
      const isConsultaHybrid = labelLower.includes("consulta");

      // Conjunto de TUSS aceitos como "ainda é Consulta" — default + extras
      // cadastrados em item_types.tuss_codes_extra.
      const normTuss = (s: string | null | undefined) =>
        String(s ?? "").replace(/\D+/g, "");
      const acceptedConsultaTuss = new Set<string>();
      if (paymentTypeMeta.tuss_default) acceptedConsultaTuss.add(normTuss(paymentTypeMeta.tuss_default));
      (paymentTypeMeta.tuss_codes_extra ?? []).forEach((c) => {
        const n = normTuss(c);
        if (n) acceptedConsultaTuss.add(n);
      });

      // Reclassificação para tipo dinâmico (Procedimento): lote Consulta + planilha
      // trouxe um TUSS que NÃO é de consulta → não é consulta, vira Procedimento.
      // Quando isso acontece, planilha vence em tudo (procedure_code e procedure_name)
      // e nada de imputação default.
      const planilhaTussNorm = normTuss(base.procedure_code);
      const shouldReclassifyOutOfConsulta =
        isConsultaHybrid
        && !!planilhaTussNorm
        && !acceptedConsultaTuss.has(planilhaTussNorm)
        && !!paymentTypeMeta.dynamic_fallback_item_type_id;

      if (shouldReclassifyOutOfConsulta) {
        payment_type_id_override = paymentTypeMeta.dynamic_fallback_item_type_id ?? null;
        (base.raw_data as Record<string, unknown>).__reclassified_from_consulta = planilhaTussNorm;
        // procedure_code/name da planilha permanecem como estão; nada de default.
      } else if (procFixed) {
        const planilhaTemTuss = !!base.procedure_code;
        const planilhaTemNome = !!base.procedure_name;
        if (paymentTypeMeta.tuss_default && (!isConsultaHybrid || !planilhaTemTuss)) {
          base.procedure_code = paymentTypeMeta.tuss_default;
          (base.raw_data as Record<string, unknown>).__tuss_default_applied = paymentTypeMeta.tuss_default;
        }
        if (!isConsultaHybrid || !planilhaTemNome) {
          const especDest = toStr(pick(row, [
            "espec dest", "espec. dest", "especialidade destino",
            "especialidade do parecerista", "especialidade",
          ]));
          const baseName = paymentTypeMeta.label || "Procedimento";
          base.procedure_name = especDest ? `${baseName} - ${especDest}` : baseName;
          (base.raw_data as Record<string, unknown>).__procedure_name_defaulted = base.procedure_name;
        }
      } else if (!base.procedure_code && paymentTypeMeta.tuss_default) {
        base.procedure_code = paymentTypeMeta.tuss_default;
        (base.raw_data as Record<string, unknown>).__tuss_default_applied = paymentTypeMeta.tuss_default;
      }

      if (!base.doctor_role && paymentTypeMeta.default_function) {
        base.doctor_role = paymentTypeMeta.default_function;
        (base.raw_data as Record<string, unknown>).__role_default_applied = paymentTypeMeta.default_function;
      }
      if (paymentTypeMeta.default_function) {
        base.sector = null;
        (base.raw_data as Record<string, unknown>).__sector_skipped_by_payment_type = true;
      }
    }

    const explicitType = extractExplicitItemType(row);
    const tipo_linha = explicitType ?? classifyLine(base, paymentKind || null);
    const withType = { ...base, tipo_linha, payment_type_id_override };


    const line_issues = validateLine(withType);
    if (accessRouteNorm.fallback && accessRouteNorm.raw) {
      line_issues.push({
        severity: "alerta",
        field: "access_route",
        message: `Via de acesso "${accessRouteNorm.raw}" não corresponde às 4 canônicas — convertida para "Sem via". Revise se o motor deve cruzar como outra via.`,
      });
    }
    return { ...withType, line_issues } as ParsedRow;
  }).filter((r) => {
    // Filtra rodapés/totalizadores que vêm na coluna "Médico":
    // "TOTAL", "TOTAL GERAL", "TOTAL VISITA", "TOTAL PARECER", "TOTAL VISITAS E PARECERES",
    // "SUBTOTAL", "DIVIDIDO POR ...", "DESCONTO DE FINAL DE SEMANA" (é dedução, não item).
    const FOOTER_DOCTOR = /^\s*(total(\s+geral|\s+visita(s)?|\s+parecer(es)?|\s+visitas?\s+e\s+parecer(es)?)?|subtotal|soma|dividido\s+por|desconto\s+de\s+final\s+de\s+semana|valor\s+(da\s+)?nf|nota\s+fiscal)\s*$/i;
    if (r.doctor_name && FOOTER_DOCTOR.test(r.doctor_name)) return false;
    // Filtra linhas onde a coluna "Paciente" carrega cabeçalho de empresa
    // (ex.: "MORAIS E CARVALHO SERVICOS MEDICOS LTDA / ...") sem médico nem valor.
    if (
      !r.doctor_name &&
      !r.procedure_code &&
      Math.abs(Number(r.gross_amount ?? 0)) === 0 &&
      Math.abs(Number(r.procedure_amount ?? 0)) === 0 &&
      r.patient_name &&
      /\b(ltda|servic[oõ]s?\s+m[eé]dicos|eireli|s\.?a\.?|me\b|epp\b)\b/i.test(r.patient_name)
    ) {
      return false;
    }
    return r.doctor_name || Math.abs(r.gross_amount) > 0 || r.procedure_code || r.description;
  });

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
  const wb = readWorkbookPreservingText(buf, { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  preserveFormattedBrazilianNumbers(sheet);
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
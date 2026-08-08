/**
 * rawCellFormat — helper ÚNICO de formatação de exibição da base crua.
 *
 * Contexto: o Excel guarda datas como serial numérico (dias desde 1899-12-30,
 * com a fração do dia representando a hora). Quando a planilha é lida com
 * `raw: true` (que é o que preserva o dado fiel), a célula chega no banco como
 * `46230.58125`. Isso é o valor CORRETO para auditoria, mas ilegível na tela.
 *
 * REGRA: aqui é SÓ EXIBIÇÃO. O valor bruto continua intacto em
 * `payment_items.raw_data` / no arquivo original. Nada nesta lib grava nada.
 *
 * Usado por:
 *  - RawDataTable (aba "Base importada" na página da empresa no lote)
 *  - ExcelPreviewDialog (modal "Ver planilha" da importação)
 */

export type RawColKind = "date" | "time" | "datetime" | "currency" | "other";

const deaccent = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Faixa plausível de serial Excel: ~1982 (30000) a ~2064 (60000). */
const SERIAL_MIN = 30000;
const SERIAL_MAX = 60000;

/**
 * Classifica a coluna pelo NOME do cabeçalho. Só o nome — nunca inferimos
 * "isso parece dinheiro" a partir do conteúdo sozinho, para não transformar
 * quantidade/código/TUSS em R$.
 */
export function detectRawColKind(header: string): RawColKind {
  const h = deaccent(header);
  if (!h) return "other";

  // Moeda primeiro: "valor liberacao" tem "liberac" (data) mas é dinheiro.
  const isCurrency =
    /(^|[\s_./-])(valor|vlr|vl|preco|total|subtotal|repasse|liquido|bruto|honorario|honorarios|desconto|glosa|credito|debito|acrescimo|taxa|custo|montante|saldo|remuneracao|pagamento)([\s_./-]|$)/.test(
      h,
    ) || /r\$/.test(h);
  if (isCurrency) return "currency";

  const isDate =
    /(^|[\s_./-])(dt|data|dat)([\s_./-]|$)|nascimento|liberac|emissa|emissao|vencim|competenc|admiss|alta|evoluc|realiz|proced|atend|solicit|entrada|saida|inicio|fim|termino|cadastro|lancamento/.test(
      h,
    );
  const isTime = /^hora$|(^|[\s_./-])(hora|horario)([\s_./-]|$)|(^|[\s_./-])hr([\s_./-]|$)|hh:mm/.test(h);

  if (isDate && isTime) return "datetime";
  if (isDate) return "date";
  if (isTime) return "time";
  return "other";
}

/** Serial Excel → Date (base 1899-12-30). Retorna null fora da faixa plausível. */
export function excelSerialToDate(n: number): Date | null {
  if (!Number.isFinite(n) || n <= 0 || n > 200000) return null;
  return new Date(Date.UTC(1899, 11, 30) + n * 86400 * 1000);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Fração de dia (0–1) → "HH:MM". */
const fracToHHMM = (frac: number): string => {
  const total = Math.round(frac * 24 * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = ((total % 60) + 60) % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
};

/**
 * A conversão é feita em UTC de propósito: o serial Excel não carrega fuso.
 * Ler em UTC evita o clássico "dia anterior" que aparece quando o navegador
 * está em UTC-3 e o serial é meia-noite.
 */
const formatSerialAsDate = (n: number, withTime: boolean): string | null => {
  const dt = excelSerialToDate(n);
  if (!dt) return null;
  const d = `${pad2(dt.getUTCDate())}/${pad2(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}`;
  if (!withTime) return d;
  const frac = n - Math.floor(n);
  // Só mostra hora quando a fração é significativa (> ~1 minuto).
  if (frac <= 1 / 1440) return d;
  return `${d} ${fracToHHMM(frac)}`;
};

const currencyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Converte texto numérico em número, aceitando pt-BR ("1.234,56") e US
 * ("1234.56"). Retorna null quando não é um número puro.
 */
export function parseLooseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  // Rejeita qualquer coisa que não seja número/separadores/sinal/R$.
  if (!/^-?\s*(r\$)?\s*[\d.,\s]+$/i.test(s)) return null;
  const cleaned = s.replace(/r\$/i, "").replace(/\s/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    // O separador decimal é o que aparece por último.
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else if (hasDot) {
    // "1.234" com 3 dígitos após o ponto e sem decimais = separador de milhar.
    if (/^-?\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Formata uma célula crua para exibição.
 * Sempre devolve string — jamais lança, jamais muda o dado de origem.
 */
export function formatRawCell(raw: unknown, kind: RawColKind): string {
  if (raw == null || raw === "") return "";

  if (raw instanceof Date) {
    if (Number.isNaN(+raw)) return String(raw);
    const d = `${pad2(raw.getUTCDate())}/${pad2(raw.getUTCMonth() + 1)}/${raw.getUTCFullYear()}`;
    if (kind === "time") return `${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}`;
    const hasTime = raw.getUTCHours() || raw.getUTCMinutes();
    if (kind === "datetime" || hasTime) return `${d} ${pad2(raw.getUTCHours())}:${pad2(raw.getUTCMinutes())}`;
    return d;
  }

  if (kind === "currency") {
    const n = parseLooseNumber(raw);
    return n == null ? String(raw) : currencyFmt.format(n);
  }

  if (kind === "time") {
    const n = parseLooseNumber(raw);
    if (n != null && n >= 0 && n < 1) return fracToHHMM(n);
    return String(raw);
  }

  if (kind === "date" || kind === "datetime") {
    const n = parseLooseNumber(raw);
    if (n != null && n >= SERIAL_MIN && n <= SERIAL_MAX) {
      // datetime sempre tenta hora; date mostra hora só se houver fração.
      const out = formatSerialAsDate(n, true);
      if (out) return out;
    }
    return String(raw);
  }

  return String(raw);
}

/** Formata usando o nome do cabeçalho diretamente (atalho de conveniência). */
export function formatRawCellByHeader(raw: unknown, header: string): string {
  return formatRawCell(raw, detectRawColKind(header));
}

/**
 * Ordena os cabeçalhos observados segundo a ordem original da planilha.
 * `originalOrder` costuma vir de `payment_source_files.original_headers`.
 * Cabeçalhos não previstos na ordem original vão para o fim, preservando a
 * ordem em que foram observados — lotes antigos (sem original_headers)
 * simplesmente mantêm a ordem atual.
 */
export function orderHeaders(observed: string[], originalOrder?: string[] | null): string[] {
  if (!originalOrder || originalOrder.length === 0) return observed;
  const norm = (s: string) => deaccent(s).replace(/\s+/g, " ");
  const rank = new Map<string, number>();
  originalOrder.forEach((h, i) => {
    const k = norm(String(h ?? ""));
    if (k && !rank.has(k)) rank.set(k, i);
  });
  return observed
    .map((h, i) => ({ h, i, r: rank.get(norm(h)) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.h);
}

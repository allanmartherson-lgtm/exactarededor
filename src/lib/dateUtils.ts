/**
 * Formata uma string de data para exibição em PT-BR, sempre usando timezone de Brasília.
 * Aceita: "2026-04-10", "2026-04-10T11:10:00Z", "2026-04-10T11:10:00+00", null/undefined.
 *
 * Datas sem hora (ex: "2026-04-10") são tratadas como data local de Brasília,
 * não como UTC midnight (que causaria rollback de 1 dia em UTC-3).
 */
export const formatDateBR = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
      ? `${date.trim()}T12:00:00`
      : date;
    return new Date(normalized).toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return date;
  }
};

/**
 * Formata data + hora para exibição em PT-BR com timezone de Brasília.
 */
export const formatDateTimeBR = (date: string | null | undefined): string => {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date;
  }
};

// ============================================================================
// Datas de competência (Y-M-D puro, sem fuso horário)
// ----------------------------------------------------------------------------
// Regra do projeto: competência, período de apuração, competence_month, datas
// de procedimento etc. são sempre strings "YYYY-MM-DD" (ou "YYYY-MM"). Nunca
// devem ser convertidas pelo fuso do navegador — `new Date("2026-04-01")`
// interpreta como UTC midnight e vira 31/03 21:00 em UTC-3, corrompendo
// competência, janelas de filtro e exibição.
//
// Use SEMPRE os helpers abaixo em vez de `new Date(...)` cru para essas datas.
// ============================================================================

/** Regex Y-M-D estrito (aceita ISO com sufixo de hora — usa só os 10 primeiros chars). */
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Regex Y-M competência estrito. */
const YM_RE = /^(\d{4})-(\d{2})$/;

/** true se `s` começa com uma data Y-M-D válida (mês 1-12, dia 1-31). */
export function isValidYmd(s: string | null | undefined): boolean {
  if (!s) return false;
  const m = String(s).slice(0, 10).match(YMD_RE);
  if (!m) return false;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

/** true se `s` é uma competência Y-M válida (mês 1-12). */
export function isValidYm(s: string | null | undefined): boolean {
  if (!s) return false;
  const m = String(s).match(YM_RE);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

/**
 * Extrai Y-M-D puro de uma string ISO (`"2026-04-01"`, `"2026-04-01T03:00:00Z"`,
 * `"2026-04-01T00:00:00-03:00"`), **sem** aplicar shift de fuso. Retorna null
 * quando o input não começa com Y-M-D válido — evita silenciosamente aceitar
 * lixo (ex.: `"2026/04/01"` ou string vazia).
 */
export function toYmd(value: string | null | undefined): string | null {
  if (!value) return null;
  const head = String(value).slice(0, 10);
  return isValidYmd(head) ? head : null;
}

/**
 * Parse "YYYY-MM-DD" como Date LOCAL (00:00 no fuso do navegador). Uso típico:
 * exibir com `date-fns/format` sem shift. Para janelas de filtro que voltam a
 * virar string YMD, prefira operar direto no Y-M-D (ver `addDaysYmd`).
 */
export function parseYmdLocal(value: string | null | undefined): Date {
  const ymd = toYmd(value);
  if (!ymd) {
    // Fallback tolerante: mantém comportamento anterior para strings livres.
    return new Date(String(value ?? ""));
  }
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Parse Y-M-D como Date UTC (00:00Z) — use quando gravar/comparar em UTC puro. */
export function parseYmdUtc(value: string | null | undefined): Date {
  const ymd = toYmd(value);
  if (!ymd) return new Date(NaN);
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Soma (ou subtrai) `days` a uma data Y-M-D **sem** passar por conversão de
 * fuso. Retorna Y-M-D. Retorna null quando o input é inválido.
 */
export function addDaysYmd(value: string | null | undefined, days: number): string | null {
  const d = parseYmdUtc(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Retorna a competência Y-M da data (`"2026-04-01"` → `"2026-04"`). Aceita
 * também string ISO com hora. Retorna null quando inválido.
 */
export function competenceOfYmd(value: string | null | undefined): string | null {
  const ymd = toYmd(value);
  return ymd ? ymd.slice(0, 7) : null;
}

/**
 * Lança em desenvolvimento quando `value` não é uma data Y-M-D válida. Em
 * produção apenas loga — evita quebrar telas por bug antigo em `summary`.
 * Use nos pontos onde a lógica DEPENDE de Y-M-D puro (janelas de filtro,
 * comparação de competência, agrupamento por período).
 */
export function assertYmd(value: string | null | undefined, context: string): void {
  if (isValidYmd(value)) return;
  const msg = `[dateUtils] data de competência inválida em ${context}: ${JSON.stringify(value)} — esperado "YYYY-MM-DD" sem shift de fuso.`;
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    throw new Error(msg);
  }
  // eslint-disable-next-line no-console
  console.warn(msg);
}


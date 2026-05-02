/**
 * Helpers únicos para tratar e-mails de pedido de NF (e similares).
 *
 * Toda a UI e o payload PRECISAM passar por aqui — assim, não há divergência
 * entre o que é exibido como chip, o que vai pro banco e o que vem do CSV.
 *
 * Regras:
 *   - trim + lowercase
 *   - valida formato simples local@dominio.tld
 *   - dedup preservando a ordem da primeira ocorrência
 */

/** Forma canônica de um e-mail (sem espaços, em caixa baixa). */
export const normalizeEmail = (raw: string): string =>
  (raw ?? "").trim().toLowerCase();

/** Validação leve — aceita o que o backend/Resend também aceita. */
export const isValidEmail = (raw: string): boolean => {
  const v = normalizeEmail(raw);
  if (!v || v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
};

/** Normaliza + dedup preservando a ordem. Itens inválidos são descartados. */
export const dedupEmails = (list: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = normalizeEmail(raw);
    if (!v || !isValidEmail(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
};

export type AddEmailResult =
  | { ok: true; emails: string[]; added: string; duplicate: false }
  | { ok: true; emails: string[]; added: null; duplicate: true; value: string }
  | { ok: false; reason: "empty" | "invalid"; value: string };

/**
 * Tenta adicionar um e-mail bruto a uma lista existente.
 * Sempre retorna a lista normalizada + dedup, mesmo em caso de duplicata.
 * A UI usa isso tanto no Enter/blur quanto no autosave.
 */
export const tryAddEmail = (
  current: readonly string[],
  raw: string,
): AddEmailResult => {
  const value = normalizeEmail(raw);
  if (!value) return { ok: false, reason: "empty", value };
  if (!isValidEmail(value)) return { ok: false, reason: "invalid", value };
  const base = dedupEmails(current);
  if (base.includes(value)) {
    return { ok: true, emails: base, added: null, duplicate: true, value };
  }
  return { ok: true, emails: [...base, value], added: value, duplicate: false };
};

/** Quebra entrada CSV (",", ";", "|") em e-mails normalizados e únicos. */
export const parseEmailList = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  return dedupEmails(raw.split(/[;|,\n]/));
};
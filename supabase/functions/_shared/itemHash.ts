/**
 * Sub-Onda 2B — Cálculo do hash de duplicidade de itens entre lotes.
 *
 * Espelho EXATO da função SQL `public.compute_payment_item_hash`:
 *   SHA256( norm(attendance) | norm(agreement) | YYYY-MM-DD | norm(code) | norm(role) )
 *
 * Normalização (mesma regra do SQL `public.norm_for_hash`):
 *   - lower
 *   - strip diacríticos via NFD + remoção de \u0300-\u036f
 *   - remove tudo que NÃO é [a-z0-9]
 *
 * `procedure_date` é truncada para DATE (YYYY-MM-DD) — dois eventos no mesmo
 * dia em horários diferentes geram o MESMO hash; o que diferencia é o
 * attendance_number.
 *
 * Patient_name NÃO entra no hash (decisão arquitetural — opção b).
 */

export function normForHash(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export interface HashableItem {
  attendance_number?: string | null;
  agreement_text?: string | null;
  procedure_date?: string | null; // ISO timestamptz
  procedure_code?: string | null;
  doctor_role?: string | null;
}

/** Truncate ISO timestamp to YYYY-MM-DD. Robust to date-only strings. */
function toIsoDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input);
  // Common cases: '2026-05-13', '2026-05-13T14:00:00Z', '2026-05-13 14:00:00+00'
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Computes the SHA-256 hex digest of an item — async because Web Crypto
 * `crypto.subtle.digest` is async. In Deno it's available as a global.
 *
 * Returns null when key fields are missing (matches SQL behaviour).
 */
export async function computeItemHash(input: HashableItem): Promise<string | null> {
  const att = normForHash(input.attendance_number);
  const code = normForHash(input.procedure_code);
  const date = toIsoDate(input.procedure_date);
  if (!att || !code || !date) return null;
  const agr = normForHash(input.agreement_text);
  const role = normForHash(input.doctor_role);
  const payload = `${att}|${agr}|${date}|${code}|${role}`;
  const buf = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- Status sets para classificação de duplicidade ---------- */

/** Status de pagamento que BLOQUEIAM (item entra como erro_duplicidade_pagamento). */
export const BLOCK_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  "aprovado",
  "aprovado_em_revisao",
  "aprovado_com_ressalva",
  "pedido_nf_enviado",
  "nf_recebida",
  "nf_questionada",
  "nf_divergente",
  "nf_conciliada",
  "lancado",
  "arquivado",
  "pago",
]);

/** Status de pagamento que ALERTAM (informacional, não bloqueia). */
export const WARN_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  "rascunho",
  "em_analise_ia",
  "revisao_analista",
  "aguardando_validacao",
  "devolvido_analista",
  "aguardando_aprovacao",
]);

/** Status que SÃO IGNORADOS (não contam como duplicidade). */
export const IGNORE_PAYMENT_STATUSES: ReadonlySet<string> = new Set([
  "cancelado",
  "rejeitado",
]);

export type DuplicateSeverity = "block" | "warn" | "none";

export function classifyDuplicateMatch(otherPaymentStatus: string): DuplicateSeverity {
  if (BLOCK_PAYMENT_STATUSES.has(otherPaymentStatus)) return "block";
  if (WARN_PAYMENT_STATUSES.has(otherPaymentStatus)) return "warn";
  return "none";
}

/* ---------- Sub-Onda 2B BUGFIX — Override com escopo ---------- */

export interface DuplicateOverridePayload {
  by: string;
  at: string;
  justification: string;
  /** IDs dos itens colididos no momento em que o diretor autorizou. */
  paired_with_item_ids?: string[];
  /** IDs dos lotes (payments) colididos no momento da autorização. */
  paired_with_payment_ids?: string[];
}

export interface DupMatchLite {
  other_item_id: string;
  other_payment_id: string;
  severity: "block" | "warn";
}

/**
 * Verifica se uma colisão específica está coberta pelo override.
 * Cobre quando o item OU o lote colidido está na lista pareada.
 */
export function isMatchCoveredByOverride(
  match: { other_item_id: string; other_payment_id: string },
  override: DuplicateOverridePayload | null | undefined,
): boolean {
  if (!override) return false;
  const items = override.paired_with_item_ids ?? [];
  const payments = override.paired_with_payment_ids ?? [];
  return items.includes(match.other_item_id) || payments.includes(match.other_payment_id);
}

export type EvaluatedDuplicateSeverity = "block" | "warn" | "override" | "none";

export interface EvaluatedDuplicate {
  severity: EvaluatedDuplicateSeverity;
  uncovered_matches: DupMatchLite[];
}

/**
 * Avalia o estado final de duplicidade de um item, aplicando o override
 * de escopo restrito: cada match precisa estar individualmente coberto.
 *
 *  - sem matches → "none"
 *  - todos os matches cobertos pelo override → "override"
 *  - algum match não coberto → "block"/"warn" pela pior severidade
 *    entre os NÃO cobertos (ignora o override para esses casos).
 */
export function evaluateDuplicate<T extends DupMatchLite>(
  matches: T[],
  override: DuplicateOverridePayload | null | undefined,
): { severity: EvaluatedDuplicateSeverity; uncovered: T[] } {
  if (matches.length === 0) return { severity: "none", uncovered: [] };
  const uncovered: T[] = [];
  let worst: "warn" | "block" | "none" = "none";
  for (const m of matches) {
    if (isMatchCoveredByOverride(m, override)) continue;
    uncovered.push(m);
    if (m.severity === "block") worst = "block";
    else if (worst !== "block") worst = "warn";
  }
  if (uncovered.length === 0) return { severity: "override", uncovered: [] };
  return { severity: worst === "none" ? "warn" : worst, uncovered };
}

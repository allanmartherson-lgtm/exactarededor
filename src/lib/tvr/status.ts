/**
 * Vocabulário de status do TVR: rótulos, tons, ordem e derivação.
 *
 * `effectiveTvrStatus` é a fonte única do status exibido/filtrado — badge,
 * filtro, contagem e coluna de ação devem todos passar por aqui.
 */
import type { TvrResult, TvrStatus } from "./types";

/** Identifica as linhas TVR em retroactive_reconciliation_items.source. */
export const TVR_SOURCE = "tasy_vs_repasse";

// Rótulos padronizados pela perspectiva do PAGAMENTO — deixa os pares simétricos:
//   Faltou pagar ↔ Ausente base faturamento (extremos: só num lado)
//   Pago a menos (valor/qtd) ↔ Pago a mais (match completo)
// O nome "base faturamento" substitui "TASY" para permitir outros sistemas por hospital.
export const TVR_STATUS_LABEL: Record<TvrStatus, string> = {
  nao_pago: "Faltou pagar",
  div_qtd_valor: "Pago a menos (qtd)",
  div_valor: "Pago a menos (valor)",
  pago_a_mais: "Pago a mais",
  ausente_tasy: "Ausente base faturamento",
  ok: "OK",
};

export const TVR_STATUS_TONE: Record<TvrStatus, string> = {
  nao_pago: "bg-red-100 text-red-800",
  div_qtd_valor: "bg-rose-100 text-rose-800",
  div_valor: "bg-amber-100 text-amber-800",
  pago_a_mais: "bg-fuchsia-100 text-fuchsia-800",
  ausente_tasy: "bg-purple-100 text-purple-800",
  ok: "bg-emerald-100 text-emerald-800",
};

export const TVR_STATUS_ORDER: TvrStatus[] = ["nao_pago", "div_qtd_valor", "div_valor", "pago_a_mais", "ausente_tasy", "ok"];

export const KEY_AUDIT_SOURCE_LABEL: Record<NonNullable<TvrResult["key_audit"]>["doctor"]["source"], string> = {
  repasse_id: "doctor_id (Repasse)",
  name_to_id: "Nome → doctor_id (fallback)",
  name_only: "Só nome",
  missing: "Sem médico",
};

export const KEY_AUDIT_SOURCE_TONE: Record<NonNullable<TvrResult["key_audit"]>["doctor"]["source"], string> = {
  repasse_id: "bg-emerald-100 text-emerald-800 border-emerald-200",
  name_to_id: "bg-amber-100 text-amber-800 border-amber-200",
  name_only: "bg-orange-100 text-orange-800 border-orange-200",
  missing: "bg-red-100 text-red-800 border-red-200",
};

// Fonte única de verdade para o status exibido/filtrado: em "quantidade" o
// status nunca depende de R$ (TASY não é base), só de presença/quantidade.
// Assim badge, filtro, contagem e coluna de ação sempre concordam, mesmo em
// rodadas antigas cujo r.status persistido ficou derivado do valor.
export function effectiveTvrStatus(r: TvrResult): TvrStatus {
  if (r.tipo_analise !== "quantidade") return r.status;
  if (r.status === "nao_pago" || r.status === "ausente_tasy") return r.status;
  if (r.dif_qtd < -0.5) return "pago_a_mais";
  if (r.dif_qtd > 0.5) return "div_qtd_valor";
  return "ok";
}

export function computeTvrCounts(list: TvrResult[]): Record<TvrStatus, number> {
  const c: Record<TvrStatus, number> = {
    nao_pago: 0,
    div_qtd_valor: 0,
    div_valor: 0,
    pago_a_mais: 0,
    ausente_tasy: 0,
    ok: 0,
  };
  for (const r of list) c[effectiveTvrStatus(r)]++;
  return c;
}

export function mapTvrStatusToStoredClassification(status: TvrStatus): string {
  // Grava o status TVR direto (sem CHECK constraint na coluna).
  // Único alias: "ok" -> "ok_pago" (equivalente, mantido por compatibilidade com relatórios).
  if (status === "ok") return "ok_pago";
  return status;
}

/**
 * Type guard das linhas re-hidratadas de retroactive_reconciliation_items.
 *
 * ATENÇÃO: MUTA `value` — normaliza status legados e re-deriva o status de
 * análises por quantidade in place. Comportamento preservado da versão
 * original; a re-hidratação depende dele para não perder linhas antigas.
 */
export function isTvrResult(value: unknown): value is TvrResult {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  // Alias status legados (rodadas antigas) para os canônicos atuais — evita
  // que linhas salvas como "pago_sem_tasy"/"div_qtd" desapareçam da lista após
  // a renomeação dos status.
  if (r.status === "pago_sem_tasy") r.status = "ausente_tasy";
  if (r.status === "div_qtd") r.status = "div_qtd_valor";
  // Re-derivação retroativa: rodadas antigas gravaram "status" a partir do R$
  // mesmo em análise por presença/quantidade. Recalcula em memória para bater
  // com a coluna de ação (sem exigir reprocessar a apuração).
  if (r.tipo_analise === "quantidade" && r.status !== "nao_pago" && r.status !== "ausente_tasy") {
    const difQtd = typeof r.dif_qtd === "number" ? r.dif_qtd : Number(r.dif_qtd ?? 0);
    if (difQtd < -0.5) r.status = "pago_a_mais";
    else if (difQtd > 0.5) r.status = "div_qtd_valor";
    else r.status = "ok";
  }
  return typeof r.key === "string" && TVR_STATUS_ORDER.includes(r.status as TvrStatus);
}

const AUSENTE_TASY_ESSENTIAL_FIELDS = [
  ["paciente", "Paciente"],
  ["convenio", "Convênio"],
  ["procedimento", "Procedimento"],
] as const;

export function getAusenteTasyMissingFields(r: TvrResult): string[] {
  if (r.status !== "ausente_tasy") return [];
  const out: string[] = [];
  for (const [key, label] of AUSENTE_TASY_ESSENTIAL_FIELDS) {
    const v = (r as unknown as Record<string, unknown>)[key];
    if (!v || String(v).trim() === "") out.push(label);
  }
  return out;
}

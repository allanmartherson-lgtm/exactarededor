/**
 * Mirror puro em TypeScript da trigger `public.check_group_reconciliation_gate`.
 *
 * Fonte de verdade: supabase/migrations/20260712220036_*.sql
 *
 * Regra crítica (bug 12/07/2026): o gate DEVE usar `bruto_pedido_ajustado =
 * bruto_pedido - absorbido_total` — nunca o pedido cru. Caso contrário, pacotes
 * absorvidos criam diferença fantasma e bloqueiam o envio silenciosamente
 * mesmo com a tela mostrando "Conciliado".
 */

import { computeGroupRuleTotals, type GroupItemForTotals } from "./groupRuleTotals";

export type GateInput = {
  brutoPedidoTotal: number;
  items: GroupItemForTotals[];
  blockPct: number; // ex: 0.5 (%)
  blockAbs: number; // ex: 100 (R$)
  hasOverride?: boolean;
  importMode?: string | null;
};

export type GateDecision = {
  blocked: boolean;
  reason:
    | "ok_within_tolerance"
    | "ok_override"
    | "ok_historico"
    | "blocked_diff";
  brutoPedidoAjustado: number;
  brutoRegra: number;
  absorbido: number;
  diferenca: number;
  diffPct: number;
};

export function evaluateGroupReconciliationGate(input: GateInput): GateDecision {
  const totals = computeGroupRuleTotals(input.brutoPedidoTotal, input.items);
  const brutoPedidoAjustado = totals.bruto_pedido_total - totals.absorbido_total;
  const diffPct =
    brutoPedidoAjustado === 0
      ? 0
      : Math.abs(totals.diferenca / brutoPedidoAjustado) * 100;

  const base = {
    brutoPedidoAjustado,
    brutoRegra: totals.bruto_regra_total,
    absorbido: totals.absorbido_total,
    diferenca: totals.diferenca,
    diffPct,
  };

  if ((input.importMode ?? "") === "historico") {
    return { blocked: false, reason: "ok_historico", ...base };
  }

  if (
    Math.abs(totals.diferenca) <= input.blockAbs ||
    diffPct <= input.blockPct
  ) {
    return { blocked: false, reason: "ok_within_tolerance", ...base };
  }

  if (input.hasOverride) {
    return { blocked: false, reason: "ok_override", ...base };
  }

  return { blocked: true, reason: "blocked_diff", ...base };
}

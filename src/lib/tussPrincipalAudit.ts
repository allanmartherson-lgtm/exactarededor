/**
 * Auditoria de TUSS principal
 * --------------------------------------------------------
 * Detecta itens onde o motor NÃO usou o TUSS principal do item
 * como chave para selecionar a regra/cálculo aplicado.
 *
 * Esta é uma camada puramente DERIVADA dos dados que o motor já
 * grava em payment_items.ai_findings / applied_calc_method.
 * Não altera o motor. O resultado é usado em três lugares:
 *   1) Trilha de decisão inline (ItemsDataGrid)
 *   2) Aba "Auditoria TUSS principal" no PaymentDetail
 *   3) Tela global /auditoria/tuss-principal
 */

import { supabase } from "@/integrations/supabase/client";

export type TussMismatchReason =
  | "sem_regra"
  | "sem_acordo"
  | "exclusao"
  | "pacote_absorbido"
  | "fallback_default"
  | "tuss_divergente";

export type TussMismatch = {
  reason: TussMismatchReason;
  tuss_item: string | null;
  tuss_regra: string | null;
  regra_id: string | null;
  calc_id: string | null;
  calc_method: string | null;
  detalhe: string;
};

export const REASON_LABELS: Record<TussMismatchReason, string> = {
  sem_regra: "Sem regra cadastrada",
  sem_acordo: "Sem acordo cadastrado",
  exclusao: "Exclusão aplicada",
  pacote_absorbido: "Item absorvido por pacote (TUSS diferente)",
  fallback_default: "Caiu em fallback (padrão geral)",
  tuss_divergente: "TUSS do item ≠ TUSS principal da regra",
};

const FALLBACK_METHODS = new Set([
  "sem_regra",
  "sem_acordo",
  "default_geral",
  "default_hemodinamica",
]);

const norm = (s: string | null | undefined) =>
  (s ?? "").toString().replace(/\D/g, "").slice(0, 8);

type ItemLike = {
  procedure_code?: string | null;
  applied_calc_method?: string | null;
  applied_calc_id?: string | null;
  applied_rule_id?: string | null;
  package_absorbed?: boolean | null;
  ai_findings?: Record<string, unknown> | null;
};

type CalcLike = {
  id: string;
  label?: string | null;
  package_main_code?: string | null;
  rule_id?: string | null;
  calculation_type?: string | null;
} | null;

/**
 * Detecta mismatch. Retorna null quando o motor está coerente
 * com o TUSS principal do item.
 *
 * Regras:
 *  - applied_calc_method = sem_regra / sem_acordo ⇒ mismatch
 *  - applied_calc_method = exclusao              ⇒ mismatch
 *  - default_geral / default_hemodinamica         ⇒ mismatch (fallback)
 *  - calc.package_main_code preenchido e !=
 *    procedure_code do item                       ⇒ pacote_absorbido / tuss_divergente
 */
export function detectTussMismatch(
  item: ItemLike,
  calc: CalcLike,
): TussMismatch | null {
  const method = (item.applied_calc_method ?? "").toString();
  const tussItem = norm(item.procedure_code);
  const tussCalc = calc?.package_main_code ? norm(calc.package_main_code) : null;
  const ruleId = calc?.rule_id ?? item.applied_rule_id ?? null;
  const calcId = calc?.id ?? item.applied_calc_id ?? null;

  if (method === "sem_regra") {
    return {
      reason: "sem_regra",
      tuss_item: tussItem || null,
      tuss_regra: null,
      regra_id: null,
      calc_id: null,
      calc_method: method,
      detalhe:
        "O motor não encontrou nenhuma regra cadastrada que cobrisse o TUSS principal deste item.",
    };
  }
  if (method === "sem_acordo") {
    return {
      reason: "sem_acordo",
      tuss_item: tussItem || null,
      tuss_regra: null,
      regra_id: ruleId,
      calc_id: null,
      calc_method: method,
      detalhe:
        "Existe regra para o TUSS, mas sem tabela de valor (sem acordo). Verifica só presença + quantidade.",
    };
  }
  if (method === "exclusao") {
    return {
      reason: "exclusao",
      tuss_item: tussItem || null,
      tuss_regra: tussCalc,
      regra_id: ruleId,
      calc_id: calcId,
      calc_method: method,
      detalhe: "Item caiu em uma regra de exclusão.",
    };
  }
  if (FALLBACK_METHODS.has(method)) {
    return {
      reason: "fallback_default",
      tuss_item: tussItem || null,
      tuss_regra: null,
      regra_id: ruleId,
      calc_id: calcId,
      calc_method: method,
      detalhe: `Motor aplicou padrão de fallback (${method}) em vez de uma regra específica do TUSS.`,
    };
  }

  // Caso o cálculo tenha package_main_code, exigimos match com o TUSS do item.
  if (tussCalc && tussItem && tussCalc !== tussItem) {
    const isPackage = (calc?.calculation_type ?? "").startsWith("pacote") || !!item.package_absorbed;
    return {
      reason: isPackage ? "pacote_absorbido" : "tuss_divergente",
      tuss_item: tussItem,
      tuss_regra: tussCalc,
      regra_id: ruleId,
      calc_id: calcId,
      calc_method: method,
      detalhe: isPackage
        ? `Item foi absorvido pelo pacote do TUSS ${tussCalc}, mas o TUSS principal do item é ${tussItem}.`
        : `Motor aplicou cálculo do TUSS ${tussCalc}, mas o TUSS principal do item é ${tussItem}.`,
    };
  }

  return null;
}

// ============================================================
// Overrides (resolução manual pelo analista)
// ============================================================

export type TussAuditOverride = {
  payment_item_id: string;
  resolved_by: string | null;
  resolved_at: string | null;
  justification: string | null;
};

export async function fetchOverrides(
  paymentItemIds: string[],
): Promise<Map<string, TussAuditOverride>> {
  const map = new Map<string, TussAuditOverride>();
  if (paymentItemIds.length === 0) return map;
  const { data } = await supabase
    .from("tuss_audit_overrides" as never)
    .select("payment_item_id,resolved_by,resolved_at,justification")
    .in("payment_item_id", paymentItemIds);
  for (const row of (data ?? []) as TussAuditOverride[]) {
    map.set(row.payment_item_id, row);
  }
  return map;
}

export async function resolveOverride(
  paymentItemId: string,
  userId: string | null,
  justification: string,
) {
  return supabase.from("tuss_audit_overrides" as never).upsert(
    {
      payment_item_id: paymentItemId,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      justification,
    },
    { onConflict: "payment_item_id" },
  );
}

export async function reopenOverride(paymentItemId: string) {
  return supabase
    .from("tuss_audit_overrides" as never)
    .delete()
    .eq("payment_item_id", paymentItemId);
}

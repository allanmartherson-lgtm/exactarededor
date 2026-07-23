import { supabase } from "@/integrations/supabase/client";
import type {
  FinancialImpact,
  ManualInterventionReason,
} from "@/hooks/useManualInterventionReasons";

/**
 * Grava o motivo da intervenção no payment_items ANTES da ação (acate,
 * exclusão, edição). Snapshot desnormalizado de `financial_impact` alimenta
 * relatórios de economia vs perda sem precisar reprocessar depois.
 */
export async function saveIntervention(params: {
  itemId: string;
  reason: Pick<ManualInterventionReason, "id" | "financial_impact">;
  notes?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { itemId, reason, notes } = params;
  const { error } = await supabase
    .from("payment_items")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      intervention_reason_id: reason.id,
      intervention_notes: notes?.trim() || null,
      intervention_financial_impact: reason.financial_impact,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", itemId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Limpa os campos de intervenção — usado ao desfazer acate. */
export async function clearIntervention(itemId: string) {
  await supabase
    .from("payment_items")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update({
      intervention_reason_id: null,
      intervention_notes: null,
      intervention_financial_impact: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    .eq("id", itemId);
}

export function impactBadgeClass(impact: FinancialImpact | null | undefined) {
  if (impact === "economia")
    return "bg-success/10 text-success border-success/30";
  if (impact === "perda")
    return "bg-destructive/10 text-destructive border-destructive/30";
  return "bg-muted text-muted-foreground border-muted-foreground/20";
}

export function impactLabel(impact: FinancialImpact | null | undefined) {
  if (impact === "economia") return "Economia";
  if (impact === "perda") return "Perda";
  if (impact === "neutro") return "Neutro";
  return "—";
}

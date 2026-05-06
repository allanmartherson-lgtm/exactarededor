import { supabase } from "@/integrations/supabase/client";

/**
 * Registra que um analista assumiu (ou transferiu para si) um lote.
 * - Se ninguém assumiu antes → action="assumiu".
 * - Se já havia outro analista ativo e o atual é diferente → action="transferiu".
 * - Se o atual já é o último a ter assumido → no-op (não duplica).
 *
 * source="manual" quando vem do botão "Assumir"; "auto" quando vem da 1ª ação.
 */
export async function claimPayment(
  paymentId: string,
  userId: string,
  source: "manual" | "auto" = "manual",
  note?: string,
): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  // Last assignment para inferir transferência vs. assumir.
  const { data: last } = await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
    "payment_assignments",
  )
    .select("analyst_id")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previous = (last as { analyst_id?: string | null } | null)?.analyst_id ?? null;
  if (previous && previous === userId) {
    // Já é o responsável — não registra ruído.
    return { ok: true, created: false };
  }

  const action = previous && previous !== userId ? "transferiu" : "assumiu";
  const { error } = await (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(
    "payment_assignments",
  ).insert({
    payment_id: paymentId,
    analyst_id: userId,
    previous_analyst_id: previous,
    action,
    source,
    note: note ?? null,
    created_by: userId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, created: true };
}

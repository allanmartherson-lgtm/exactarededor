/**
 * Gate de Aprovação: itens com `procedure_amount` zerado/nulo (sem base do
 * convênio) mas que foram pagos exigem um motivo de intervenção manual
 * antes de seguir para validação/aprovação. Esse helper é usado tanto
 * pelo PaymentDetail (transição do lote / do grupo) quanto pelo Zeev
 * (para abrir a tratativa em lote com os itens já carregados).
 *
 * Espelha a regra implementada em `supabase/functions/_shared/rulesEngine.ts`
 * (`exige_motivo_intervencao`). Mantenha as duas em sincronia.
 */
import { supabase } from "@/integrations/supabase/client";

export type ManualReasonGateItem = {
  id: string;
  doctor_name: string | null;
  procedure_code: string | null;
  procedure_name: string | null;
  procedure_amount: number | null;
  attendance_number: string | null;
  gross_amount: number | null;
  company_id: string | null;
};

const SPECIAL_LINES = ["complemento_bonus", "glosa_desconto", "reprocessamento"];

/**
 * Busca itens do pagamento que exigem motivo de intervenção manual.
 * - Quando `companyId` é `undefined` → considera todos os itens do lote
 *   (inclui itens de pool com `company_id = null`).
 * - Quando `companyId` é um UUID → filtra apenas itens daquela empresa.
 * - Quando `companyId` é `null` → filtra apenas itens de pool.
 */
export async function findItemsNeedingManualReason(
  paymentId: string,
  companyId?: string | null,
): Promise<ManualReasonGateItem[]> {
  let q = supabase
    .from("payment_items")
    .select(
      "id, doctor_name, procedure_code, procedure_description, procedure_amount, attendance_number, gross_amount, tipo_linha, manual_intervention_reason_id, company_id",
    )
    .eq("payment_id", paymentId)
    .is("manual_intervention_reason_id", null)
    .gt("gross_amount", 0);

  if (companyId !== undefined) {
    if (companyId === null) {
      q = q.is("company_id", null);
    } else {
      q = q.eq("company_id", companyId);
    }
  }

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? [])
    .filter((r) => {
      const proc = Number(r.procedure_amount ?? 0);
      const tl = ((r.tipo_linha as string | null) ?? "").toLowerCase();
      return proc <= 0 && !SPECIAL_LINES.includes(tl);
    })
    .map((r) => ({
      id: r.id as string,
      doctor_name: (r.doctor_name as string | null) ?? null,
      procedure_code: (r.procedure_code as string | null) ?? null,
      procedure_description:
        (r.procedure_description as string | null) ?? null,
      procedure_amount:
        r.procedure_amount == null ? null : Number(r.procedure_amount),
      attendance_number: (r.attendance_number as string | null) ?? null,
      gross_amount: r.gross_amount == null ? null : Number(r.gross_amount),
      company_id: (r.company_id as string | null) ?? null,
    }));
}

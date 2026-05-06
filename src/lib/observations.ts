import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { PaymentStatus } from "@/lib/status";

type ObservationRow = Database["public"]["Tables"]["payment_observations"]["Row"];
export type ObservationAuthorType = ObservationRow["author_type"];

/**
 * Rótulo legível do papel do autor de uma observação/registro de histórico.
 * Centralizado para garantir consistência visual em todas as telas que
 * exibem o autor (timeline, histórico do item, histórico unificado).
 */
export function authorRoleLabel(t: string | null | undefined): string {
  switch (t) {
    case "analista": return "Analista";
    case "validador": return "Validador";
    case "diretor": return "Diretor";
    case "sistema": return "Sistema";
    case "ia": return "IA";
    default: return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
  }
}

export type RecordObservationInput = {
  payment_id: string;
  author_type: ObservationAuthorType;
  author_id: string;
  message: string;
  item_id?: string | null;
  status_from?: PaymentStatus | null;
  status_to?: PaymentStatus | null;
};

export type RecordObservationResult = {
  ok: boolean;
  /** Mensagem de erro quando ok=false. String vazia em caso de sucesso. */
  error: string;
  /** Linha inserida quando ok=true. null em caso de erro. */
  data: ObservationRow | null;
};

/**
 * Insere uma observação no histórico do pagamento de forma consistente.
 *
 * Centralizar isso evita:
 *  - payloads divergentes entre origens (NewPayment, Invoices, PaymentDetail);
 *  - falhas silenciosas — sempre retorna `{ ok, error }` para o caller decidir;
 *  - omitir campos opcionais por engano (item_id, status_from/to).
 *
 * IMPORTANTE: o caller é responsável por exibir toast/feedback de erro.
 */
export async function recordObservation(
  input: RecordObservationInput,
): Promise<RecordObservationResult> {
  const payload = {
    payment_id: input.payment_id,
    author_type: input.author_type,
    author_id: input.author_id,
    message: input.message,
    item_id: input.item_id ?? null,
    status_from: input.status_from ?? null,
    status_to: input.status_to ?? null,
  };

  const { data, error } = await supabase
    .from("payment_observations")
    .insert(payload)
    .select()
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Falha ao salvar observação.", data: null };
  }
  return { ok: true, data: data as ObservationRow, error: "" };
}
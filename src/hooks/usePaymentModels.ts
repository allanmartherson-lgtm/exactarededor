import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Modelos de cálculo do LOTE (Produção / Plantão / Remessa / Valor fixo).
 * Diferente de `useItemTypes` (Parecer/Visita/Cirurgia/Consulta/...), que
 * descrevem o tipo do ITEM.
 *
 * Use este hook quando o select é claramente sobre o "modelo de pagamento
 * do lote" (cálculo, regime de competência). Para selects que misturam
 * ambos os universos (ex.: criação de novo lote onde o analista pode
 * escolher "Parecer" como tipo do lote), continue usando `usePaymentTypes`
 * que lê da view unificada.
 */
export type PaymentModelRow = {
  id: string;
  code: string;
  label: string;
  active: boolean;
  sort_order: number;
  description: string | null;
  color: string | null;
  tuss_default: string | null;
  default_function: string | null;
  allow_mixed_item_types: boolean;
  calculation_strategy: string | null;
  expected_headers: string[] | null;
};

export function usePaymentModels(opts: { onlyActive?: boolean } = { onlyActive: true }) {
  const [list, setList] = useState<PaymentModelRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    let q = (supabase.from as any)("payment_models").select("*").order("sort_order").order("label");
    if (opts.onlyActive) q = q.eq("active", true);
    const { data } = await q;
    setList((data ?? []) as PaymentModelRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.onlyActive]);

  return { list, loading, reload: load };
}

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Linha unificada para listagens de tipo na UI.
 *
 * Fase D / Onda 4: a fonte passou a ser a view `payment_types_unified`
 * (UNION de `item_types` + `payment_models`). A tabela `payment_types`
 * permanece no banco apenas por causa das 7 FKs legadas — não é mais a
 * fonte de listagem.
 *
 * `origin` discrimina cada linha entre `'item_type'` (Parecer, Visita,
 * Consulta...) e `'payment_model'` (Producao, Remessa). Campos antigos
 * (`description`, `color`) deixaram de existir na view; quem precisar
 * deles deve migrar para `useItemTypes` / leitura direta da tabela
 * apropriada.
 */
export type PaymentTypeRow = {
  id: string;
  code: string;
  label: string;
  sort_order: number;
  active: boolean;
  origin: "item_type" | "payment_model";
  description: string | null;
  color: string | null;
};

export function usePaymentTypes(opts: { onlyActive?: boolean; origin?: "item_type" | "payment_model" } = { onlyActive: true }) {
  const [list, setList] = useState<PaymentTypeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    // Cast `as any` necessário enquanto a view não está nos types gerados.
    // O contrato da view é fixo (ver migration `payment_types_unified`).
    let q = (supabase.from as any)("payment_types_unified")
      .select("id, code, label, sort_order, active, origin, description, color")
      .order("sort_order")
      .order("label");
    if (opts.onlyActive) q = q.eq("active", true);
    if (opts.origin) q = q.eq("origin", opts.origin);
    const { data } = await q;
    setList((data ?? []) as PaymentTypeRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [opts.onlyActive, opts.origin]);

  return { list, loading, reload: load };
}

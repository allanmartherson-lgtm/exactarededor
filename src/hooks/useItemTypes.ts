import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tipos do ITEM (Parecer/Visita/Cirurgia/Consulta/Bônus/Exames).
 * Diferente de payment_models (Produção/Plantão/Remessa/Valor fixo), que
 * descrevem o modelo de pagamento do LOTE.
 *
 * Fonte: nova tabela `item_types`. Os codes batem 1:1 com os codes que
 * existiam na antiga `payment_types`, então o write continua sendo no
 * `payment_type_id` (legacy) pegando o id da `payment_types` que tem o
 * mesmo code do item_type escolhido.
 */
export type ItemTypeRow = {
  id: string;
  code: string;
  label: string;
  active: boolean;
  sort_order: number;
  requires_tuss: boolean;
  is_default_when_no_tuss: boolean;
  tuss_default: string | null;
  tuss_codes_extra: string[] | null;
};

export function useItemTypes(opts: { onlyActive?: boolean } = { onlyActive: true }) {
  const [list, setList] = useState<ItemTypeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("item_types" as any).select("*").order("sort_order").order("label");
    if (opts.onlyActive) q = q.eq("active", true);
    const { data } = await q;
    setList((data ?? []) as unknown as ItemTypeRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.onlyActive]);

  return { list, loading, reload: load };
}

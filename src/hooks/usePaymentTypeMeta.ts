/**
 * @deprecated Sub-fase D2 vai remover. Use `usePaymentModels` (modelo do lote)
 * ou `useItemTypes` (tipo do item) conforme o caso. Este hook lê da tabela
 * legada `payment_types` que continua sendo populada pelo trigger de sync da
 * Fase B', mas será dropada na D2.
 *
 * Mantido enquanto o fluxo de reimportação (PaymentDetail / CompanyAnalysis)
 * depende dos campos `requires_tuss_in_sheet` e `category` que ainda não
 * existem nas tabelas novas (`item_types` / `payment_models`).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PaymentTypeMappingMeta = {
  id: string;
  code: string;
  label: string;
  category: string | null;
  tuss_default: string | null;
  requires_tuss_in_sheet: boolean;
  default_function: string | null;
};

export function usePaymentTypeMeta(paymentTypeId: string | null | undefined): PaymentTypeMappingMeta | null {
  const [meta, setMeta] = useState<PaymentTypeMappingMeta | null>(null);
  useEffect(() => {
    if (!paymentTypeId) { setMeta(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("payment_types")
        .select("id,code,label,category,tuss_default,requires_tuss_in_sheet,default_function")
        .eq("id", paymentTypeId)
        .maybeSingle();
      if (cancelled || !data) return;
      setMeta({
        id: (data as any).id,
        code: (data as any).code,
        label: (data as any).label,
        category: (data as any).category ?? null,
        tuss_default: (data as any).tuss_default ?? null,
        requires_tuss_in_sheet: (data as any).requires_tuss_in_sheet ?? true,
        default_function: (data as any).default_function ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [paymentTypeId]);
  return meta;
}


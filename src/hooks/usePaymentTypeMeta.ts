/**
 * Carrega o subconjunto de `payment_types` necessário para o parse de planilhas
 * e o diálogo de mapeamento de colunas. É a fonte de verdade compartilhada
 * entre o fluxo de IMPORTAÇÃO (NewPayment) e o de REIMPORTAÇÃO
 * (CompanyAnalysis / PaymentDetail). Sem isso, a tela de reimportação
 * exige TUSS/Função mesmo quando o tipo (parecer, visita, plantão fixo)
 * já injeta esses valores automaticamente.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PaymentTypeMappingMeta = {
  id: string;
  code: string;
  label: string;
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
        .select("id,code,label,tuss_default,requires_tuss_in_sheet,default_function")
        .eq("id", paymentTypeId)
        .maybeSingle();
      if (cancelled || !data) return;
      setMeta({
        id: (data as any).id,
        code: (data as any).code,
        label: (data as any).label,
        tuss_default: (data as any).tuss_default ?? null,
        requires_tuss_in_sheet: (data as any).requires_tuss_in_sheet ?? true,
        default_function: (data as any).default_function ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [paymentTypeId]);
  return meta;
}

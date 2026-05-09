import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calculateFinancialRisk, type RiskBreakdown } from "@/lib/riskScore";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

/**
 * Hook leve para calcular o score de risco de UM lote em listagens.
 * NÃO usa realtime e busca apenas os campos necessários para o cálculo.
 * Use em listas/cards onde o detalhe completo não é necessário.
 */
export function usePaymentRisk(paymentId: string | undefined): RiskBreakdown | null {
  const [risk, setRisk] = useState<RiskBreakdown | null>(null);

  useEffect(() => {
    if (!paymentId) {
      setRisk(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("payment_items")
      .select("gross_amount, ai_status, tipo_linha, authorized_exception")
      .eq("payment_id", paymentId)
      .then(({ data }) => {
        if (cancelled) return;
        const items = (data ?? []) as unknown as PaymentItemRow[];
        setRisk(calculateFinancialRisk(items));
      });
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  return risk;
}

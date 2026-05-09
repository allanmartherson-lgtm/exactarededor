import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calculateFinancialRisk, type RiskBreakdown } from "@/lib/riskScore";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

/**
 * Hook leve para calcular o score de risco de UM lote em listagens.
 * Usa useQuery para caching e deduplicação de requisições.
 * Busca apenas os campos necessários para o cálculo.
 */
export function usePaymentRisk(paymentId: string | undefined): RiskBreakdown | null {
  const queryClient = useQueryClient();

  const { data: risk } = useQuery({
    queryKey: ["payment-risk", paymentId],
    queryFn: async () => {
      if (!paymentId) return null;
      
      const { data, error } = await supabase
        .from("payment_items")
        .select("gross_amount, ai_status, tipo_linha, authorized_exception")
        .eq("payment_id", paymentId);
        
      if (error) {
        console.error("Error fetching payment risk data:", error);
        throw error;
      }
      
      const items = (data ?? []) as unknown as PaymentItemRow[];
      return calculateFinancialRisk(items);
    },
    enabled: !!paymentId,
    staleTime: 1000 * 60 * 5, // 5 minutos de cache
  });

  // Realtime: Invalida o cache se houver mudança nos itens do lote
  useEffect(() => {
    if (!paymentId) return;

    const channel = supabase
      .channel(`payment-risk:${paymentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "payment_items",
          filter: `payment_id=eq.${paymentId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["payment-risk", paymentId] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [paymentId, queryClient]);

  return risk ?? null;
}

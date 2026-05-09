import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calculateFinancialRisk, type RiskBreakdown } from "@/lib/riskScore";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";

type PaymentRiskRealtimeEntry = {
  channel: ReturnType<typeof supabase.channel>;
  subscribers: number;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
};

const paymentRiskRealtimeSubscriptions = new Map<string, PaymentRiskRealtimeEntry>();

const subscribeToPaymentRisk = (paymentId: string, queryClient: QueryClient) => {
  const existing = paymentRiskRealtimeSubscriptions.get(paymentId);

  if (existing) {
    existing.subscribers += 1;
    if (existing.cleanupTimer) {
      clearTimeout(existing.cleanupTimer);
      existing.cleanupTimer = null;
    }
    return () => releasePaymentRiskSubscription(paymentId);
  }

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
    );

  paymentRiskRealtimeSubscriptions.set(paymentId, {
    channel,
    subscribers: 1,
    cleanupTimer: null,
  });

  channel.subscribe();

  return () => releasePaymentRiskSubscription(paymentId);
};

const releasePaymentRiskSubscription = (paymentId: string) => {
  const entry = paymentRiskRealtimeSubscriptions.get(paymentId);
  if (!entry) return;

  entry.subscribers -= 1;
  if (entry.subscribers > 0 || entry.cleanupTimer) return;

  entry.cleanupTimer = setTimeout(() => {
    const latest = paymentRiskRealtimeSubscriptions.get(paymentId);
    if (!latest || latest.subscribers > 0) return;

    paymentRiskRealtimeSubscriptions.delete(paymentId);
    supabase.removeChannel(latest.channel);
  }, 1500);
};

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

  // Realtime: uma única assinatura por lote, compartilhada por todos os cards/linhas.
  useEffect(() => {
    if (!paymentId) return;

    return subscribeToPaymentRisk(paymentId, queryClient);
  }, [paymentId, queryClient]);

  return risk ?? null;
}

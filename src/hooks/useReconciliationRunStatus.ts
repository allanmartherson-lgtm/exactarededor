import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Existe alguma rodada de conciliação (`reconciliation_runs`) para este
 * pagamento? Extraído de PaymentDetail.tsx/CompanyAnalysis.tsx, que
 * mantinham o mesmo `useEffect` (consulta + assinatura realtime no mesmo
 * canal/tabela) escrito separadamente em cada arquivo.
 *
 * Retorna `null` enquanto a primeira checagem não respondeu — os
 * consumidores que precisam distinguir "carregando" de "confirmado sem
 * conciliação" (ex.: desabilitar um botão) podem checar `=== null`.
 */
export function useReconciliationRunStatus(paymentId: string | undefined): boolean | null {
  const [hasRun, setHasRun] = useState<boolean | null>(null);

  useEffect(() => {
    if (!paymentId) return;
    let active = true;
    const check = async () => {
      const { count } = await supabase
        .from("reconciliation_runs")
        .select("id", { count: "exact", head: true })
        .eq("payment_id", paymentId);
      if (active) setHasRun((count ?? 0) > 0);
    };
    check();
    const channel = supabase
      .channel(`recon-runs:${paymentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reconciliation_runs", filter: `payment_id=eq.${paymentId}` },
        () => check(),
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [paymentId]);

  return hasRun;
}

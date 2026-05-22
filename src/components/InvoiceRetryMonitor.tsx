import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const RETRY_INTERVAL_MS = 30 * 60_000; // 30 min
const MAX_RETRIES_PER_CYCLE = 5;
const LOOKBACK_HOURS = 48;

/**
 * Componente invisível: a cada 30 min, busca NFs com send_error e tenta
 * reenviar automaticamente (até 5 por ciclo, janela de 48h).
 */
export function InvoiceRetryMonitor() {
  const runningRef = useRef(false);

  useEffect(() => {
    const tick = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
        const { data: failedInvoices, error } = await supabase
          .from("invoices")
          .select("id, payment_id, company_name, send_error")
          .not("send_error", "is", null)
          .eq("status", "aguardando")
          .is("sent_at", null)
          .gte("created_at", cutoff)
          .limit(MAX_RETRIES_PER_CYCLE);

        if (error || !failedInvoices?.length) return;

        for (const inv of failedInvoices) {
          try {
            const { error: invokeErr } = await supabase.functions.invoke(
              "send-invoice-request",
              { body: { payment_id: inv.payment_id } },
            );
            if (!invokeErr) {
              toast.info(`NF reenviada automaticamente para ${inv.company_name ?? "empresa"}`);
            }
          } catch {
            // silencioso — próximo ciclo tenta de novo
          }
        }
      } finally {
        runningRef.current = false;
      }
    };

    tick();
    const id = setInterval(tick, RETRY_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return null;
}

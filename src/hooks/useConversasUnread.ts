/**
 * Total de mensagens não lidas no menu Conversas:
 *  - soma de `company_threads.unread_for_internal`
 *  - count de `doctor_messages` onde author_type='medico' e read_at IS NULL
 *
 * Refetch a cada 60s. Retorna 0 enquanto carrega.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useConversasUnread(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [threadsRes, messagesRes] = await Promise.all([
          supabase.from("company_threads" as never).select("unread_for_internal"),
          supabase
            .from("doctor_messages" as never)
            .select("id", { count: "exact", head: true })
            .eq("author_type", "medico")
            .is("read_at", null),
        ]);

        if (cancelled) return;

        const rows = (threadsRes.data ?? []) as Array<{ unread_for_internal: number | null }>;
        const threadsSum = rows.reduce((s, r) => s + (r.unread_for_internal ?? 0), 0);
        const doctorsCount = messagesRes.count ?? 0;
        setTotal(threadsSum + doctorsCount);
      } catch {
        // silencioso
      }
    };

    void load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return total;
}

/**
 * Total de mensagens não lidas no menu Conversas:
 *  - soma de `company_threads.unread_for_internal` (portal de empresa)
 *  - count de `doctor_messages` onde author_type='medico' e read_at IS NULL (portal médico)
 *  - count de `payment_questions` que o usuário atual ainda não leu
 *    (conversas internas analista ↔ supervisor ↔ diretor)
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
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id ?? null;

        const [threadsRes, doctorsRes, internalUnread] = await Promise.all([
          supabase.from("company_threads" as never).select("unread_for_internal"),
          supabase
            .from("doctor_messages" as never)
            .select("id", { count: "exact", head: true })
            .eq("author_type", "medico")
            .is("read_at", null),
          countInternalUnread(uid),
        ]);

        if (cancelled) return;

        const rows = (threadsRes.data ?? []) as Array<{ unread_for_internal: number | null }>;
        const threadsSum = rows.reduce((s, r) => s + (r.unread_for_internal ?? 0), 0);
        const doctorsCount = doctorsRes.count ?? 0;
        setTotal(threadsSum + doctorsCount + internalUnread);
      } catch {
        // silencioso
      }
    };

    void load();
    const id = window.setInterval(load, 60_000);

    // Realtime: recarrega imediatamente quando há nova payment_question,
    // nova leitura, mudança em company_threads ou doctor_messages.
    const channel = supabase
      .channel("conversas-unread-counter")
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_questions" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_question_reads" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "company_threads" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "doctor_messages" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "doctor_notifications" }, () => void load())
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(id);
      void supabase.removeChannel(channel);
    };
  }, []);

  return total;
}

/**
 * Conta mensagens de `payment_questions` que NÃO foram escritas pelo usuário
 * atual e que ele ainda não marcou como lidas em `payment_question_reads`.
 */
async function countInternalUnread(uid: string | null): Promise<number> {
  if (!uid) return 0;
  try {
    // Busca todas as mensagens internas não autoradas pelo usuário atual.
    const { data: msgs } = await supabase
      .from("payment_questions" as never)
      .select("id, author_id")
      .neq("author_id", uid);
    const ids = ((msgs ?? []) as Array<{ id: string }>).map((m) => m.id);
    if (!ids.length) return 0;

    // Busca reads do usuário atual para essas mensagens.
    const { data: reads } = await supabase
      .from("payment_question_reads" as never)
      .select("message_id")
      .eq("user_id", uid)
      .in("message_id", ids);
    const readSet = new Set(
      ((reads ?? []) as Array<{ message_id: string }>).map((r) => r.message_id),
    );
    return ids.filter((id) => !readSet.has(id)).length;
  } catch {
    return 0;
  }
}

/**
 * Assina mudanças em `intervention_ledger` e chama `onChange` com debounce.
 *
 * Motivo: `materialize_intervention_ledger` faz DELETE+INSERT em lote (300+
 * linhas por aprovação). Sem debounce, cada linha dispararia um reload
 * completo do RPC caro `get_intervention_savings`.
 *
 * O filtro por hospital acontece client-side: o RPC já respeita RLS e a
 * publicação Realtime também, então recebemos só o que temos permissão de
 * ver. Ainda assim filtramos por `hospital_id` recebido para não recarregar
 * quando outro hospital do mesmo usuário admin/diretor recebe eventos.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useInterventionLedgerRealtime(
  hospitalId: string | null | undefined,
  onChange: () => void,
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        cbRef.current();
      }, 800);
    };

    const channel = supabase
      .channel(`intervention_ledger_realtime_${hospitalId ?? "all"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "intervention_ledger" },
        (payload) => {
          // Só reagir se o evento pertencer ao hospital corrente. Quando
          // hospitalId é nulo/undefined (visão global do diretor), aceitamos
          // todos.
          if (hospitalId) {
            const row = (payload.new ?? payload.old) as { hospital_id?: string | null } | null;
            if (row?.hospital_id && row.hospital_id !== hospitalId) return;
          }
          scheduleReload();
        },
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [hospitalId]);
}

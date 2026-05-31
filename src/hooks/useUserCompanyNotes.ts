import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UserCompanyMarker = "pinned" | "waiting" | "reviewed" | null;

export type UserCompanyNote = {
  id: string;
  group_id: string;
  note: string;
  marker: UserCompanyMarker;
  waiting_info: string;
};

/**
 * Notas pessoais + marcadores por empresa (visíveis SÓ para o próprio usuário).
 * - Mapa por group_id em memória.
 * - setNote/setWaitingInfo: debounce 800ms (texto). setMarker: imediato.
 */
export function useUserCompanyNotes(paymentId: string | undefined) {
  const [byGroup, setByGroup] = useState<Record<string, UserCompanyNote>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const debounceRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const reload = useCallback(async () => {
    if (!paymentId || !userId) return;
    const { data } = await supabase
      .from("user_company_notes")
      .select("id, group_id, note, marker, waiting_info")
      .eq("payment_id", paymentId)
      .eq("user_id", userId);
    const map: Record<string, UserCompanyNote> = {};
    (data ?? []).forEach((r: any) => {
      map[r.group_id] = {
        id: r.id,
        group_id: r.group_id,
        note: r.note ?? "",
        marker: r.marker ?? null,
        waiting_info: r.waiting_info ?? "",
      };
    });
    setByGroup(map);
  }, [paymentId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const persist = useCallback(
    async (groupId: string, patch: Partial<Pick<UserCompanyNote, "note" | "marker" | "waiting_info">>) => {
      if (!paymentId || !userId) return;
      const existing = byGroup[groupId];
      const payload = {
        user_id: userId,
        payment_id: paymentId,
        group_id: groupId,
        note: patch.note ?? existing?.note ?? "",
        marker: (patch.marker !== undefined ? patch.marker : existing?.marker) ?? null,
        waiting_info: patch.waiting_info ?? existing?.waiting_info ?? "",
      };
      const { data } = await supabase
        .from("user_company_notes")
        .upsert(payload, { onConflict: "user_id,group_id" })
        .select("id, group_id, note, marker, waiting_info")
        .single();
      if (data) {
        setByGroup((prev) => ({
          ...prev,
          [groupId]: {
            id: (data as any).id,
            group_id: (data as any).group_id,
            note: (data as any).note ?? "",
            marker: (data as any).marker ?? null,
            waiting_info: (data as any).waiting_info ?? "",
          },
        }));
      }
    },
    [paymentId, userId, byGroup],
  );

  const optimistic = useCallback(
    (groupId: string, patch: Partial<UserCompanyNote>) => {
      setByGroup((prev) => ({
        ...prev,
        [groupId]: {
          id: prev[groupId]?.id ?? "",
          group_id: groupId,
          note: prev[groupId]?.note ?? "",
          marker: prev[groupId]?.marker ?? null,
          waiting_info: prev[groupId]?.waiting_info ?? "",
          ...patch,
        },
      }));
    },
    [],
  );

  const debounceKey = (groupId: string, field: string) => `${groupId}::${field}`;

  const setNote = useCallback(
    (groupId: string, note: string) => {
      optimistic(groupId, { note });
      persist(groupId, { note });
    },
    [persist, optimistic],
  );

  const setWaitingInfo = useCallback(
    (groupId: string, waiting_info: string) => {
      optimistic(groupId, { waiting_info });
      persist(groupId, { waiting_info });
    },
    [persist, optimistic],
  );

  const setMarker = useCallback(
    (groupId: string, marker: UserCompanyMarker) => {
      optimistic(groupId, { marker });
      persist(groupId, { marker });
    },
    [persist, optimistic],
  );

  return { byGroup, setNote, setWaitingInfo, setMarker, reload };
}

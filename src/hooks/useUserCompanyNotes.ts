import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UserCompanyMarker = "pinned" | "waiting" | "reviewed" | null;

export type UserCompanyNote = {
  id: string;
  group_id: string;
  note: string;
  marker: UserCompanyMarker;
};

/**
 * Notas pessoais + marcadores por empresa (visíveis SÓ para o próprio usuário).
 * - Mapa por group_id em memória.
 * - upsertNote: debounce 800ms (texto). setMarker: imediato.
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
      .select("id, group_id, note, marker")
      .eq("payment_id", paymentId)
      .eq("user_id", userId);
    const map: Record<string, UserCompanyNote> = {};
    (data ?? []).forEach((r: any) => {
      map[r.group_id] = r as UserCompanyNote;
    });
    setByGroup(map);
  }, [paymentId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const persist = useCallback(
    async (groupId: string, patch: Partial<Pick<UserCompanyNote, "note" | "marker">>) => {
      if (!paymentId || !userId) return;
      const existing = byGroup[groupId];
      const payload = {
        user_id: userId,
        payment_id: paymentId,
        group_id: groupId,
        note: patch.note ?? existing?.note ?? "",
        marker: (patch.marker !== undefined ? patch.marker : existing?.marker) ?? null,
      };
      const { data } = await supabase
        .from("user_company_notes")
        .upsert(payload, { onConflict: "user_id,group_id" })
        .select("id, group_id, note, marker")
        .single();
      if (data) {
        setByGroup((prev) => ({ ...prev, [groupId]: data as UserCompanyNote }));
      }
    },
    [paymentId, userId, byGroup],
  );

  const setNote = useCallback(
    (groupId: string, note: string) => {
      // otimista
      setByGroup((prev) => ({
        ...prev,
        [groupId]: {
          id: prev[groupId]?.id ?? "",
          group_id: groupId,
          note,
          marker: prev[groupId]?.marker ?? null,
        },
      }));
      if (debounceRefs.current[groupId]) clearTimeout(debounceRefs.current[groupId]);
      debounceRefs.current[groupId] = setTimeout(() => {
        persist(groupId, { note });
      }, 800);
    },
    [persist],
  );

  const setMarker = useCallback(
    (groupId: string, marker: UserCompanyMarker) => {
      setByGroup((prev) => ({
        ...prev,
        [groupId]: {
          id: prev[groupId]?.id ?? "",
          group_id: groupId,
          note: prev[groupId]?.note ?? "",
          marker,
        },
      }));
      persist(groupId, { marker });
    },
    [persist],
  );

  return { byGroup, setNote, setMarker, reload };
}

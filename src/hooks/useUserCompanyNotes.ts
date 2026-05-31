import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type UserCompanyMarker = "pinned" | "waiting" | "reviewed" | null;

export type UserCompanyNote = {
  id: string;
  group_id: string;
  note: string;
  marker: UserCompanyMarker;
  waiting_info: string;
};

export type NoteSaveStatus = "idle" | "saving" | "saved" | "error";

export type NoteAttachment = {
  id: string;
  group_id: string;
  file_name: string;
  file_path: string;
  mime_type: string | null;
  size_bytes: number;
  created_at: string;
};

const BUCKET = "user-company-notes";

/**
 * Notas pessoais + marcadores + anexos por empresa (visíveis SÓ para o próprio usuário).
 *
 * Performance: as referências de byGroup ficam num ref para que `persist`/`setNote`
 * etc. sejam estáveis e não disparem re-render em cascata em componentes pais
 * grandes (PaymentDetail, CompanyAnalysis).
 *
 * Auto-save: cada grupo expõe um status ("saving" | "saved" | "error" | "idle")
 * acessível em `saveStatus[groupId]` para a UI mostrar o indicador.
 */
export function useUserCompanyNotes(paymentId: string | undefined) {
  const [byGroup, setByGroup] = useState<Record<string, UserCompanyNote>>({});
  const [attachmentsByGroup, setAttachmentsByGroup] = useState<Record<string, NoteAttachment[]>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, NoteSaveStatus>>({});
  const [userId, setUserId] = useState<string | null>(null);

  // Mantemos byGroup num ref para que callbacks fiquem estáveis (evita cascata
  // de re-renders no PaymentDetail/CompanyAnalysis a cada keystroke).
  const byGroupRef = useRef(byGroup);
  byGroupRef.current = byGroup;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const reload = useCallback(async () => {
    if (!paymentId || !userId) return;
    const [notesRes, attRes] = await Promise.all([
      supabase
        .from("user_company_notes")
        .select("id, group_id, note, marker, waiting_info")
        .eq("payment_id", paymentId)
        .eq("user_id", userId),
      supabase
        .from("user_company_note_attachments")
        .select("id, group_id, file_name, file_path, mime_type, size_bytes, created_at")
        .eq("payment_id", paymentId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ]);

    const map: Record<string, UserCompanyNote> = {};
    (notesRes.data ?? []).forEach((r: any) => {
      map[r.group_id] = {
        id: r.id,
        group_id: r.group_id,
        note: r.note ?? "",
        marker: r.marker ?? null,
        waiting_info: r.waiting_info ?? "",
      };
    });
    setByGroup(map);

    const att: Record<string, NoteAttachment[]> = {};
    (attRes.data ?? []).forEach((r: any) => {
      const item: NoteAttachment = {
        id: r.id,
        group_id: r.group_id,
        file_name: r.file_name,
        file_path: r.file_path,
        mime_type: r.mime_type ?? null,
        size_bytes: Number(r.size_bytes ?? 0),
        created_at: r.created_at,
      };
      (att[r.group_id] ||= []).push(item);
    });
    setAttachmentsByGroup(att);
  }, [paymentId, userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const markStatus = useCallback((groupId: string, status: NoteSaveStatus) => {
    setSaveStatus((prev) => ({ ...prev, [groupId]: status }));
  }, []);

  // Timer p/ esconder o "salvo" automaticamente após alguns segundos.
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const flashSaved = useCallback((groupId: string) => {
    markStatus(groupId, "saved");
    if (savedTimers.current[groupId]) clearTimeout(savedTimers.current[groupId]);
    savedTimers.current[groupId] = setTimeout(() => {
      setSaveStatus((prev) => (prev[groupId] === "saved" ? { ...prev, [groupId]: "idle" } : prev));
    }, 2500);
  }, [markStatus]);

  const persist = useCallback(
    async (groupId: string, patch: Partial<Pick<UserCompanyNote, "note" | "marker" | "waiting_info">>) => {
      if (!paymentId || !userId) return;
      const existing = byGroupRef.current[groupId];
      const payload = {
        user_id: userId,
        payment_id: paymentId,
        group_id: groupId,
        note: patch.note ?? existing?.note ?? "",
        marker: (patch.marker !== undefined ? patch.marker : existing?.marker) ?? null,
        waiting_info: patch.waiting_info ?? existing?.waiting_info ?? "",
      };
      markStatus(groupId, "saving");
      const { data, error } = await supabase
        .from("user_company_notes")
        .upsert(payload, { onConflict: "user_id,group_id" })
        .select("id, group_id, note, marker, waiting_info")
        .single();
      if (error || !data) {
        markStatus(groupId, "error");
        return;
      }
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
      flashSaved(groupId);
    },
    [paymentId, userId, markStatus, flashSaved],
  );

  const optimistic = useCallback((groupId: string, patch: Partial<UserCompanyNote>) => {
    setByGroup((prev) => {
      const cur = prev[groupId];
      const next: UserCompanyNote = {
        id: cur?.id ?? "",
        group_id: groupId,
        note: cur?.note ?? "",
        marker: cur?.marker ?? null,
        waiting_info: cur?.waiting_info ?? "",
        ...patch,
      };
      // Evita re-render se nada mudou (chamadas duplicadas do debounce).
      if (
        cur &&
        cur.note === next.note &&
        cur.marker === next.marker &&
        cur.waiting_info === next.waiting_info
      ) {
        return prev;
      }
      return { ...prev, [groupId]: next };
    });
  }, []);

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

  // ============ Anexos ============

  const uploadAttachment = useCallback(
    async (groupId: string, file: File) => {
      if (!paymentId || !userId) return;
      markStatus(groupId, "saving");
      try {
        const safeName = file.name.replace(/[^\w.\-]+/g, "_");
        const path = `${userId}/${paymentId}/${groupId}/${Date.now()}-${safeName}`;
        const up = await supabase.storage.from(BUCKET).upload(path, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });
        if (up.error) throw up.error;
        const ins = await supabase
          .from("user_company_note_attachments")
          .insert({
            user_id: userId,
            payment_id: paymentId,
            group_id: groupId,
            file_name: file.name,
            file_path: path,
            mime_type: file.type || null,
            size_bytes: file.size,
          })
          .select("id, group_id, file_name, file_path, mime_type, size_bytes, created_at")
          .single();
        if (ins.error || !ins.data) throw ins.error;
        const row = ins.data as any;
        const item: NoteAttachment = {
          id: row.id,
          group_id: row.group_id,
          file_name: row.file_name,
          file_path: row.file_path,
          mime_type: row.mime_type ?? null,
          size_bytes: Number(row.size_bytes ?? 0),
          created_at: row.created_at,
        };
        setAttachmentsByGroup((prev) => ({
          ...prev,
          [groupId]: [item, ...(prev[groupId] ?? [])],
        }));
        flashSaved(groupId);
      } catch (e) {
        console.error("[useUserCompanyNotes] uploadAttachment", e);
        markStatus(groupId, "error");
      }
    },
    [paymentId, userId, markStatus, flashSaved],
  );

  const deleteAttachment = useCallback(
    async (groupId: string, attachmentId: string) => {
      const list = attachmentsByGroup[groupId] ?? [];
      const target = list.find((a) => a.id === attachmentId);
      if (!target) return;
      markStatus(groupId, "saving");
      try {
        await supabase.storage.from(BUCKET).remove([target.file_path]);
        const { error } = await supabase
          .from("user_company_note_attachments")
          .delete()
          .eq("id", attachmentId);
        if (error) throw error;
        setAttachmentsByGroup((prev) => ({
          ...prev,
          [groupId]: (prev[groupId] ?? []).filter((a) => a.id !== attachmentId),
        }));
        flashSaved(groupId);
      } catch (e) {
        console.error("[useUserCompanyNotes] deleteAttachment", e);
        markStatus(groupId, "error");
      }
    },
    [attachmentsByGroup, markStatus, flashSaved],
  );

  const downloadAttachment = useCallback(async (att: NoteAttachment) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(att.file_path, 60, { download: att.file_name });
    if (error || !data?.signedUrl) {
      console.error("[useUserCompanyNotes] downloadAttachment", error);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }, []);

  return useMemo(
    () => ({
      byGroup,
      attachmentsByGroup,
      saveStatus,
      setNote,
      setWaitingInfo,
      setMarker,
      uploadAttachment,
      deleteAttachment,
      downloadAttachment,
      reload,
    }),
    [
      byGroup,
      attachmentsByGroup,
      saveStatus,
      setNote,
      setWaitingInfo,
      setMarker,
      uploadAttachment,
      deleteAttachment,
      downloadAttachment,
      reload,
    ],
  );
}

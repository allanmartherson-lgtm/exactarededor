import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  AttachmentRow,
  EventRow,
  EventType,
  MessageRow,
  ReadRow,
  Thread,
} from "./types";

type Args = {
  paymentId: string;
  currentUserId: string;
  enabled: boolean;
};

type State = {
  loading: boolean;
  messages: MessageRow[];
  reads: ReadRow[];
  attachments: AttachmentRow[];
  events: EventRow[];
};

/**
 * Data layer for the chat-style Conversations panel.
 * Fetches threads, reads, attachments and audit events for a payment
 * and keeps everything in sync via realtime subscriptions.
 */
export function useConversations({ paymentId, currentUserId, enabled }: Args) {
  const [state, setState] = useState<State>({
    loading: true,
    messages: [],
    reads: [],
    attachments: [],
    events: [],
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const load = useCallback(async () => {
    if (!enabled || !paymentId) return;
    const [m, r, a, e] = await Promise.all([
      supabase
        .from("payment_questions")
        .select("*")
        .eq("payment_id", paymentId)
        .order("created_at", { ascending: true }),
      supabase.from("payment_question_reads" as never).select("*"),
      supabase
        .from("payment_question_attachments" as never)
        .select("*")
        .eq("payment_id", paymentId),
      supabase
        .from("payment_question_events" as never)
        .select("*")
        .eq("payment_id", paymentId)
        .order("created_at", { ascending: true }),
    ]);
    setState({
      loading: false,
      messages: ((m.data ?? []) as unknown) as MessageRow[],
      reads: ((r.data ?? []) as unknown) as ReadRow[],
      attachments: ((a.data ?? []) as unknown) as AttachmentRow[],
      events: ((e.data ?? []) as unknown) as EventRow[],
    });
  }, [paymentId, enabled]);

  useEffect(() => {
    if (!enabled || !paymentId) return;
    void load();
    const ch = supabase
      .channel(`conv-${paymentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_questions", filter: `payment_id=eq.${paymentId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_question_reads" },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_question_attachments", filter: `payment_id=eq.${paymentId}` },
        () => void load(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment_question_events", filter: `payment_id=eq.${paymentId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [enabled, paymentId, load]);

  /** Build threads tree, with unread count per-user. */
  const threads = useMemo<Thread[]>(() => {
    const roots = state.messages.filter((m) => !m.parent_id);
    const repliesByParent = new Map<string, MessageRow[]>();
    state.messages.forEach((m) => {
      if (m.parent_id) {
        const arr = repliesByParent.get(m.parent_id) ?? [];
        arr.push(m);
        repliesByParent.set(m.parent_id, arr);
      }
    });
    const attachByMsg = new Map<string, AttachmentRow[]>();
    state.attachments.forEach((a) => {
      const arr = attachByMsg.get(a.question_id) ?? [];
      arr.push(a);
      attachByMsg.set(a.question_id, arr);
    });
    const myReadSet = new Set(state.reads.filter((r) => r.user_id === currentUserId).map((r) => r.message_id));
    const eventsByThread = new Map<string, EventRow[]>();
    state.events.forEach((ev) => {
      const arr = eventsByThread.get(ev.thread_root_id) ?? [];
      arr.push(ev);
      eventsByThread.set(ev.thread_root_id, arr);
    });

    return roots.map<Thread>((root) => {
      const replies = repliesByParent.get(root.id) ?? [];
      const allMsgs = [root, ...replies];
      const participantIds = new Set<string>();
      allMsgs.forEach((m) => participantIds.add(m.author_id));
      const attachmentsByMessage: Record<string, AttachmentRow[]> = {};
      allMsgs.forEach((m) => {
        const list = attachByMsg.get(m.id);
        if (list && list.length) attachmentsByMessage[m.id] = list;
      });
      const unreadForMe = allMsgs.filter(
        (m) => m.author_id !== currentUserId && !myReadSet.has(m.id),
      ).length;
      const lastActivityAt = allMsgs
        .map((m) => m.created_at)
        .sort()
        .pop() ?? root.created_at;
      return {
        root,
        replies,
        events: eventsByThread.get(root.id) ?? [],
        attachmentsByMessage,
        unreadForMe,
        participantIds,
        lastActivityAt,
      };
    });
  }, [state, currentUserId]);

  /** Read receipts grouped by message → set of user_ids who read it. */
  const readsByMessage = useMemo(() => {
    const map = new Map<string, Set<string>>();
    state.reads.forEach((r) => {
      const s = map.get(r.message_id) ?? new Set<string>();
      s.add(r.user_id);
      map.set(r.message_id, s);
    });
    return map;
  }, [state.reads]);

  // ──────────────── Mutations ────────────────

  const sendMessage = useCallback(
    async (opts: {
      threadRoot?: MessageRow | null;
      companyGroupId?: string | null;
      authorName: string;
      role: string;
      text: string;
      files?: File[];
    }) => {
      const trimmed = opts.text.trim();
      if (!trimmed) throw new Error("Mensagem vazia");
      const groupId = opts.threadRoot ? opts.threadRoot.company_group_id : (opts.companyGroupId ?? null);
      const { data: inserted, error } = await supabase
        .from("payment_questions")
        .insert({
          payment_id: paymentId,
          company_group_id: groupId,
          parent_id: opts.threadRoot?.id ?? null,
          author_id: currentUserId,
          author_name: opts.authorName,
          author_type: "interno",
          message: trimmed,
        })
        .select("id")
        .single();
      if (error || !inserted) throw error ?? new Error("Falha ao enviar");
      const messageId = inserted.id as string;

      // Upload files (in parallel) and link.
      if (opts.files && opts.files.length) {
        await Promise.all(
          opts.files.map(async (file) => {
            const path = `${paymentId}/${messageId}/${crypto.randomUUID()}-${file.name}`;
            const up = await supabase.storage
              .from("payment-question-attachments")
              .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
            if (up.error) throw up.error;
            const { error: aErr } = await supabase
              .from("payment_question_attachments" as never)
              .insert({
                question_id: messageId,
                payment_id: paymentId,
                author_id: currentUserId,
                author_name: opts.authorName,
                author_type: "interno",
                file_name: file.name,
                storage_path: path,
                mime_type: file.type || "application/octet-stream",
                size_bytes: file.size,
              } as never);
            if (aErr) throw aErr;
          }),
        );
      }

      // Mark my own message as read by me.
      await supabase
        .from("payment_question_reads" as never)
        .upsert(
          { message_id: messageId, user_id: currentUserId, read_at: new Date().toISOString() } as never,
          { onConflict: "message_id,user_id" } as never,
        );

      // Trigger notification (legacy edge function still works).
      const rootId = opts.threadRoot?.id ?? messageId;
      supabase.functions
        .invoke("notify-internal-question", {
          body: {
            event: opts.threadRoot ? "reply" : "created",
            payment_id: paymentId,
            question_observation_id: rootId,
            source: "payment_questions",
            asker_role: opts.role,
          },
        })
        .catch((e) => console.warn("notify-internal-question failed", e));

      await load();
      return messageId;
    },
    [paymentId, currentUserId, load],
  );

  const markThreadRead = useCallback(
    async (thread: Thread) => {
      if (thread.unreadForMe === 0) return;
      const all = [thread.root, ...thread.replies];
      const myReadSet = new Set(
        state.reads.filter((r) => r.user_id === currentUserId).map((r) => r.message_id),
      );
      const toMark = all.filter((m) => m.author_id !== currentUserId && !myReadSet.has(m.id));
      if (!toMark.length) return;
      const now = new Date().toISOString();
      await supabase
        .from("payment_question_reads" as never)
        .upsert(
          toMark.map((m) => ({ message_id: m.id, user_id: currentUserId, read_at: now })) as never,
          { onConflict: "message_id,user_id" } as never,
        );
      await load();
    },
    [state.reads, currentUserId, load],
  );

  const logEvent = useCallback(
    async (
      threadRootId: string,
      eventType: EventType,
      actorName: string,
      payload: Record<string, unknown> = {},
    ) => {
      await supabase.from("payment_question_events" as never).insert({
        thread_root_id: threadRootId,
        payment_id: paymentId,
        event_type: eventType,
        actor_id: currentUserId,
        actor_name: actorName,
        payload,
      } as never);
    },
    [paymentId, currentUserId],
  );

  const assignTo = useCallback(
    async (thread: Thread, assigneeId: string | null, assigneeName: string | null, actorName: string) => {
      const wasAssigned = thread.root.assigned_to;
      const { error } = await supabase
        .from("payment_questions")
        .update({ assigned_to: assigneeId })
        .eq("id", thread.root.id);
      if (error) throw error;
      const eventType: EventType = assigneeId === null
        ? "unassigned"
        : wasAssigned
        ? "reassigned"
        : "assigned";
      await logEvent(thread.root.id, eventType, actorName, {
        previous_assignee: wasAssigned,
        new_assignee: assigneeId,
        new_assignee_name: assigneeName,
      });
      await load();
    },
    [logEvent, load],
  );

  const closeThread = useCallback(
    async (thread: Thread, actorName: string) => {
      const { error } = await supabase
        .from("payment_questions")
        .update({ status: "encerrada" })
        .eq("id", thread.root.id);
      if (error) throw error;
      await logEvent(thread.root.id, "closed", actorName);
      await load();
    },
    [logEvent, load],
  );

  const reopenThread = useCallback(
    async (thread: Thread, actorName: string) => {
      const { error } = await supabase
        .from("payment_questions")
        .update({ status: "pendente" })
        .eq("id", thread.root.id);
      if (error) throw error;
      await logEvent(thread.root.id, "reopened", actorName);
      await load();
    },
    [logEvent, load],
  );

  const getSignedUrl = useCallback(async (storagePath: string): Promise<string | null> => {
    const { data } = await supabase.storage
      .from("payment-question-attachments")
      .createSignedUrl(storagePath, 600);
    return data?.signedUrl ?? null;
  }, []);

  return {
    loading: state.loading,
    threads,
    readsByMessage,
    sendMessage,
    markThreadRead,
    assignTo,
    closeThread,
    reopenThread,
    getSignedUrl,
    reload: load,
  };
}

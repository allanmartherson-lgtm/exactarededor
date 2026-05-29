/**
 * Painel de chat reutilizável para uma `company_threads`.
 *
 * - Carrega mensagens via `company_messages`, ordenadas por created_at.
 * - Realtime: assina `postgres_changes` em `company_messages` filtrando pela thread.
 * - Marca como lidas (read_by_internal_at) ao montar e a cada nova mensagem da empresa.
 * - Permite enviar resposta como analista (author_type='analista').
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Send, Building2 } from "lucide-react";

type Message = {
  id: string;
  thread_id: string;
  company_id: string;
  author_user_id: string | null;
  author_type: "empresa" | "analista" | "sistema";
  author_name: string;
  message: string;
  read_by_company_at: string | null;
  read_by_internal_at: string | null;
  created_at: string;
};

interface Props {
  threadId: string;
  companyId: string;
  /** Altura do painel (default: auto via flex). */
  className?: string;
}

export function CompanyThreadChat({ threadId, companyId, className }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Marca todas mensagens da empresa como lidas (server-side update via RLS internal_all).
  const markRead = useCallback(async () => {
    await supabase
      .from("company_messages" as never)
      .update({ read_by_internal_at: new Date().toISOString() } as never)
      .eq("thread_id", threadId)
      .eq("author_type", "empresa")
      .is("read_by_internal_at", null);
    // Zera contador da thread.
    await supabase
      .from("company_threads" as never)
      .update({ unread_for_internal: 0 } as never)
      .eq("id", threadId);
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("company_messages" as never)
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setMessages([]);
      } else {
        setMessages((data ?? []) as unknown as Message[]);
        await markRead();
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, markRead]);

  // Realtime: novas mensagens na thread.
  useEffect(() => {
    const channel = supabase
      .channel(`thread-${threadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "company_messages",
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const m = payload.new as unknown as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          if (m.author_type === "empresa") void markRead();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [threadId, markRead]);

  // Auto-scroll para o final ao chegar mensagem nova.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending || !user) return;
    setSending(true);
    const authorName =
      (user.user_metadata?.full_name as string) || (user.email ?? "Analista");
    const { error } = await supabase.from("company_messages" as never).insert({
      thread_id: threadId,
      company_id: companyId,
      author_user_id: user.id,
      author_type: "analista",
      author_name: authorName,
      message: body,
    } as never);
    setSending(false);
    if (error) {
      setError(error.message);
      return;
    }
    setText("");
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  };

  const grouped = useMemo(() => messages, [messages]);

  return (
    <div className={cn("flex flex-col min-h-0 border border-border rounded-lg bg-card", className)}>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3"
      >
        {loading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-3/4" />
            <Skeleton className="h-14 w-3/4 self-end" />
            <Skeleton className="h-14 w-2/3" />
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-destructive">Falha ao carregar: {error}</p>
        )}
        {!loading && !error && grouped.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-12">
            Nenhuma mensagem ainda. Envie uma resposta para iniciar a conversa.
          </p>
        )}
        {grouped.map((m) => {
          const mine = m.author_type === "analista";
          const system = m.author_type === "sistema";
          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-col gap-1 max-w-[78%]",
                mine ? "self-end items-end" : "self-start items-start",
                system && "self-center items-center max-w-full",
              )}
            >
              {!system && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                  {!mine && <Building2 className="h-3 w-3" />}
                  {m.author_name} ·{" "}
                  {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                </span>
              )}
              <div
                className={cn(
                  "rounded-lg px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words",
                  system
                    ? "bg-muted text-muted-foreground text-[12px] italic"
                    : mine
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                )}
              >
                {m.message}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3 flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Responder como analista… (⌘/Ctrl + Enter para enviar)"
          rows={3}
          className="resize-none text-[13.5px]"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground">
            Você está respondendo em nome da equipe interna.
          </span>
          <Button
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            size="sm"
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            {sending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

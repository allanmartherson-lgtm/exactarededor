/**
 * Chat de pendência aberta por médico — usa `doctor_messages`.
 *
 * Mantém a conversa SEPARADA do portal da empresa: quando uma pendência
 * é registrada no app do médico (`pendencias.opened_by = 'medico'`), as
 * respostas do analista devem aparecer no aplicativo do médico, não na
 * tela de conversas da empresa vinculada.
 *
 * - Filtra por `doctor_id` + `thread_id = pendencia.id` para escopar
 *   somente as mensagens desta pendência.
 * - Realtime: assina INSERT/UPDATE em `doctor_messages`.
 * - Marca como lidas (read_at) as mensagens enviadas pelo médico.
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
import { Send, Stethoscope } from "lucide-react";

type DoctorMsg = {
  id: string;
  doctor_id: string;
  author_user_id: string | null;
  author_type: "medico" | "equipe_interna";
  author_name: string;
  message: string;
  read_at: string | null;
  read_by_doctor_at: string | null;
  created_at: string;
  thread_id: string | null;
};

interface Props {
  pendenciaId: string;
  doctorId: string;
  doctorName?: string;
  className?: string;
}

export function DoctorPendenciaChat({ pendenciaId, doctorId, doctorName, className }: Props) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DoctorMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [authorName, setAuthorName] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setAuthorName((data?.full_name as string | null) ?? user.email ?? "Equipe");
      });
  }, [user?.id, user?.email]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("doctor_messages" as never)
      .select(
        "id,doctor_id,author_user_id,author_type,author_name,message,read_at,read_by_doctor_at,created_at,thread_id",
      )
      .eq("doctor_id", doctorId)
      .eq("thread_id", pendenciaId)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) {
      setError(error.message);
      setMessages([]);
    } else {
      setMessages((data ?? []) as unknown as DoctorMsg[]);
    }
    setLoading(false);
  }, [doctorId, pendenciaId]);

  const markRead = useCallback(async () => {
    await supabase
      .from("doctor_messages" as never)
      .update({ read_at: new Date().toISOString() } as never)
      .eq("doctor_id", doctorId)
      .eq("thread_id", pendenciaId)
      .eq("author_type", "medico")
      .is("read_at", null);
  }, [doctorId, pendenciaId]);

  useEffect(() => {
    void load().then(() => void markRead());
    const channel = supabase
      .channel(`doctor-pendencia-${pendenciaId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "doctor_messages", filter: `thread_id=eq.${pendenciaId}` },
        () => {
          void load().then(() => void markRead());
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, markRead, pendenciaId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    if (!text.trim() || !user?.id) return;
    setSending(true);
    const { error } = await supabase.from("doctor_messages" as never).insert({
      doctor_id: doctorId,
      thread_id: pendenciaId,
      author_type: "equipe_interna",
      author_user_id: user.id,
      author_name: authorName || user.email || "Equipe",
      message: text.trim(),
    } as never);
    setSending(false);
    if (!error) {
      setText("");
      void load();
    } else {
      setError(error.message);
    }
  };

  const sorted = useMemo(() => messages, [messages]);

  return (
    <div className={cn("flex flex-col border border-border rounded-lg bg-card min-h-0", className)}>
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Stethoscope className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium truncate">
          Conversa com o médico {doctorName ? `· ${doctorName}` : ""}
        </span>
        <span className="ml-auto text-[10.5px] uppercase tracking-wider text-muted-foreground">
          App do médico
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 min-h-0">
        {loading && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-2/3" />
            ))}
          </div>
        )}
        {!loading && error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && sorted.length === 0 && (
          <p className="text-sm text-muted-foreground text-center my-auto">
            Nenhuma mensagem ainda. Sua resposta será entregue no aplicativo do médico.
          </p>
        )}
        {sorted.map((m) => {
          const fromDoctor = m.author_type === "medico";
          return (
            <div
              key={m.id}
              className={cn(
                "max-w-[78%] flex flex-col gap-0.5",
                fromDoctor ? "self-start items-start" : "self-end items-end",
              )}
            >
              <div
                className={cn(
                  "rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                  fromDoctor ? "bg-muted text-foreground" : "bg-primary text-primary-foreground",
                )}
              >
                {m.message}
              </div>
              <span className="text-[10.5px] text-muted-foreground px-1">
                {m.author_name} · {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                {!fromDoctor && m.read_by_doctor_at ? " · lida" : ""}
              </span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-border p-3 flex items-end gap-2">
        <Textarea
          placeholder="Responder para o médico…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={sending}
          className="min-h-[44px] max-h-32"
        />
        <Button type="button" onClick={() => void send()} disabled={sending || !text.trim()} className="gap-1.5">
          <Send className="h-4 w-4" />
          Enviar
        </Button>
      </div>
    </div>
  );
}

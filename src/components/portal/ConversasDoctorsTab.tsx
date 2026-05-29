/**
 * Aba "Médicos" da página Conversas.
 *
 * - Lista médicos com mensagens em `doctor_messages` (lado esquerdo).
 * - Painel direito: thread cronológica + input de resposta.
 * - Realtime: assina INSERT/UPDATE em `doctor_messages`.
 *
 * Observação: `author_type` é restrito a 'medico' | 'equipe_interna' pelo
 * check constraint da tabela. Para mensagens da equipe interna usamos
 * sempre 'equipe_interna' (o papel real fica implícito pelo author_user_id).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Stethoscope, Inbox, Send } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

type DoctorMessage = {
  id: string;
  doctor_id: string;
  author_type: "medico" | "equipe_interna";
  author_name: string;
  message: string;
  read_at: string | null;
  created_at: string;
  payment_id: string | null;
};

type DoctorRow = {
  doctor_id: string;
  full_name: string;
  last_message: string;
  last_at: string;
  unread: number;
};

export function ConversasDoctorsTab() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DoctorMessage[]>([]);
  const [doctorNames, setDoctorNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [authorName, setAuthorName] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Resolve nome do autor (profile.full_name → email).
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

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("doctor_messages" as never)
      .select("id,doctor_id,author_type,author_name,message,read_at,created_at,payment_id")
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) {
      setError(error.message);
      setMessages([]);
    } else {
      const list = (data ?? []) as unknown as DoctorMessage[];
      setMessages(list);
      const ids = Array.from(new Set(list.map((m) => m.doctor_id)));
      if (ids.length > 0) {
        const { data: docs } = await supabase
          .from("doctors")
          .select("id, full_name")
          .in("id", ids);
        const map: Record<string, string> = {};
        (docs ?? []).forEach((d: { id: string; full_name: string }) => {
          map[d.id] = d.full_name;
        });
        setDoctorNames(map);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("conversas-doctors")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "doctor_messages" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Agrupa por médico (lista da esquerda).
  const doctorRows: DoctorRow[] = useMemo(() => {
    const byDoctor = new Map<string, DoctorRow>();
    // messages já vem ordenado desc por created_at.
    for (const m of messages) {
      const cur = byDoctor.get(m.doctor_id);
      if (!cur) {
        byDoctor.set(m.doctor_id, {
          doctor_id: m.doctor_id,
          full_name: doctorNames[m.doctor_id] ?? "Médico",
          last_message: m.message,
          last_at: m.created_at,
          unread: m.author_type === "medico" && m.read_at === null ? 1 : 0,
        });
      } else if (m.author_type === "medico" && m.read_at === null) {
        cur.unread += 1;
      }
    }
    return Array.from(byDoctor.values()).sort((a, b) =>
      b.last_at.localeCompare(a.last_at),
    );
  }, [messages, doctorNames]);

  // Auto-seleciona o primeiro.
  useEffect(() => {
    if (!selectedDoctorId && doctorRows.length > 0) {
      setSelectedDoctorId(doctorRows[0].doctor_id);
    }
  }, [doctorRows, selectedDoctorId]);

  // Mensagens da thread (ordem cronológica asc).
  const threadMessages = useMemo(() => {
    if (!selectedDoctorId) return [];
    return messages
      .filter((m) => m.doctor_id === selectedDoctorId)
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [messages, selectedDoctorId]);

  // Marcar como lidas ao abrir thread.
  useEffect(() => {
    if (!selectedDoctorId) return;
    const hasUnread = messages.some(
      (m) => m.doctor_id === selectedDoctorId && m.author_type === "medico" && m.read_at === null,
    );
    if (!hasUnread) return;
    void (supabase.from("doctor_messages" as never) as never)
      .update({ read_at: new Date().toISOString() } as never)
      .eq("doctor_id", selectedDoctorId)
      .eq("author_type", "medico")
      .is("read_at", null)
      .then(() => {
        // Realtime cuidará do refresh; otimisticamente marca local.
        setMessages((prev) =>
          prev.map((m) =>
            m.doctor_id === selectedDoctorId && m.author_type === "medico" && m.read_at === null
              ? { ...m, read_at: new Date().toISOString() }
              : m,
          ),
        );
      });
  }, [selectedDoctorId, messages]);

  // Scroll para o fim ao trocar thread / receber mensagens.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadMessages.length, selectedDoctorId]);

  const sendReply = async () => {
    if (!selectedDoctorId || !reply.trim() || !user?.id) return;
    setSending(true);
    const { error } = await supabase.from("doctor_messages" as never).insert({
      doctor_id: selectedDoctorId,
      author_type: "equipe_interna",
      author_user_id: user.id,
      author_name: authorName || user.email || "Equipe",
      message: reply.trim(),
      payment_id: null,
    } as never);
    setSending(false);
    if (!error) {
      setReply("");
      void load();
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-3 flex-1 min-h-0">
      {/* Lista de médicos */}
      <div className="border border-border rounded-lg bg-card overflow-y-auto min-h-0">
        {loading && (
          <div className="p-3 flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}
        {!loading && error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {!loading && !error && doctorRows.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <Inbox className="h-6 w-6 opacity-60" />
            Nenhuma mensagem de médico.
          </div>
        )}
        {!loading &&
          !error &&
          doctorRows.map((d) => {
            const isActive = d.doctor_id === selectedDoctorId;
            return (
              <button
                key={d.doctor_id}
                type="button"
                onClick={() => setSelectedDoctorId(d.doctor_id)}
                className={cn(
                  "w-full text-left px-3 py-3 border-b border-border/60 last:border-b-0 transition-colors flex flex-col gap-1",
                  isActive ? "bg-accent" : "hover:bg-muted/50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground min-w-0">
                    <Stethoscope className="h-3 w-3 flex-shrink-0" />
                    <span className="truncate">{d.full_name}</span>
                  </span>
                  <span className="text-[10.5px] text-muted-foreground flex-shrink-0">
                    {format(new Date(d.last_at), "dd/MM HH:mm", { locale: ptBR })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-[13px] truncate flex-1",
                      d.unread > 0 ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {d.last_message}
                  </span>
                  {d.unread > 0 && (
                    <span className="min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center px-1">
                      {d.unread > 9 ? "9+" : d.unread}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
      </div>

      {/* Painel direito: thread */}
      <div className="min-h-0 flex flex-col border border-border rounded-lg bg-card">
        {!selectedDoctorId ? (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Selecione um médico à esquerda.
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Stethoscope className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium truncate">
                {doctorNames[selectedDoctorId] ?? "Médico"}
              </span>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
              {threadMessages.map((m) => {
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
                        fromDoctor
                          ? "bg-muted text-foreground"
                          : "bg-primary text-primary-foreground",
                      )}
                    >
                      {m.message}
                    </div>
                    <span className="text-[10.5px] text-muted-foreground px-1">
                      {m.author_name} · {format(new Date(m.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                );
              })}
              {threadMessages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center my-auto">
                  Sem mensagens ainda.
                </p>
              )}
            </div>
            <div className="border-t border-border p-3 flex items-center gap-2">
              <Input
                placeholder="Escreva uma resposta…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendReply();
                  }
                }}
                disabled={sending}
              />
              <Button
                type="button"
                onClick={() => void sendReply()}
                disabled={sending || !reply.trim()}
                className="gap-1.5"
              >
                <Send className="h-4 w-4" />
                Enviar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Loader2, CheckCircle2, AlertCircle, RotateCcw } from "lucide-react";
import { ZeevIcon } from "./ZeevIcon";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Action = "set_sector" | "set_cost_center" | "link_doctor_company";

type Proposal = {
  action: Action;
  scope: Record<string, unknown>;
  payload: Record<string, unknown>;
  summary: string;
  preview_count: number;
  sample_items: Array<{
    id: string;
    doctor_name: string | null;
    procedure_code: string | null;
    description: string | null;
    attendance_number: string | null;
  }>;
};

type Msg =
  | { role: "user"; text: string }
  | { role: "zeev"; text: string }
  | { role: "proposal"; proposal: Proposal; status: "pending" | "confirmed" | "cancelled" | "applying"; result?: string };

const ACTION_LABEL: Record<Action, string> = {
  set_sector: "Definir setor em lote",
  set_cost_center: "Definir centro de custos em lote",
  link_doctor_company: "Vincular médico → empresa",
};

interface Props {
  paymentId: string;
  onApplied?: () => void;
}

export function ZeevExecutorChat({ paymentId, onApplied }: Props) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "zeev",
      text: "Pode me pedir ações em lote sobre este pagamento. Ex.: \"coloca setor CC em todos sem setor\" ou \"vincula os médicos sem empresa na PJ X\". Sempre confirmo com você antes de aplicar.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const propose = useCallback(
    async (prompt: string) => {
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke("zeev-executor", {
          body: { step: "propose", payment_id: paymentId, prompt },
        });
        if (error) throw error;
        const r = data as
          | { step: "propose"; proposal: Proposal }
          | { step: "respond"; action: string; summary: string };
        if (r.step === "respond") {
          setMessages((m) => [...m, { role: "zeev", text: r.summary }]);
        } else {
          setMessages((m) => [...m, { role: "proposal", proposal: r.proposal, status: "pending" }]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) => [...m, { role: "zeev", text: `Não consegui processar: ${msg}` }]);
      } finally {
        setBusy(false);
      }
    },
    [paymentId],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    await propose(text);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [input, busy, propose]);

  const confirm = useCallback(
    async (idx: number, proposal: Proposal) => {
      setMessages((m) => m.map((msg, i) => (i === idx && msg.role === "proposal" ? { ...msg, status: "applying" } : msg)));
      try {
        const { data, error } = await supabase.functions.invoke("zeev-executor", {
          body: { step: "execute", payment_id: paymentId, proposal },
        });
        if (error) throw error;
        const r = data as { affected: number; message: string };
        setMessages((m) =>
          m.map((msg, i) => (i === idx && msg.role === "proposal" ? { ...msg, status: "confirmed", result: r.message } : msg)),
        );
        toast.success(r.message);
        onApplied?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) =>
          m.map((message, i) =>
            i === idx && message.role === "proposal" ? { ...message, status: "pending", result: undefined } : message,
          ),
        );
        toast.error(`Falha ao aplicar: ${msg}`);
      }
    },
    [paymentId, onApplied],
  );

  const cancel = useCallback((idx: number) => {
    setMessages((m) => m.map((msg, i) => (i === idx && msg.role === "proposal" ? { ...msg, status: "cancelled" } : msg)));
  }, []);

  return (
    <div className="flex flex-col h-[440px]">
      {/* Histórico */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-[13px] text-primary-foreground leading-snug break-words">
                  {m.text}
                </div>
              </div>
            );
          }
          if (m.role === "zeev") {
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary mt-0.5">
                  <ZeevIcon className="h-3 w-3" />
                </div>
                <div className="max-w-[85%] text-[13px] text-foreground leading-snug break-words">{m.text}</div>
              </div>
            );
          }
          // proposal card
          const p = m.proposal;
          const isDone = m.status === "confirmed" || m.status === "cancelled";
          return (
            <div key={i} className="flex items-start gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary mt-0.5">
                <ZeevIcon className="h-3 w-3" />
              </div>
              <div className={cn(
                "flex-1 rounded-xl border p-3 space-y-2",
                m.status === "confirmed" && "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20",
                m.status === "cancelled" && "border-border bg-muted/40 opacity-70",
                m.status === "pending" && "border-primary/30 bg-primary-soft/30",
                m.status === "applying" && "border-primary/30 bg-primary-soft/30",
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    {ACTION_LABEL[p.action]}
                  </div>
                  {m.status === "confirmed" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                  {m.status === "cancelled" && <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
                </div>
                <p className="text-[13px] text-foreground leading-snug">{p.summary}</p>
                <div className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{p.preview_count}</strong> {p.preview_count === 1 ? "item afetado" : "itens afetados"}
                  {p.preview_count > 0 && p.sample_items.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[11px]">
                      {p.sample_items.map((s) => (
                        <li key={s.id} className="truncate">
                          • {s.doctor_name ?? "—"} · {s.procedure_code ?? "—"} · {s.description ?? "—"}
                        </li>
                      ))}
                      {p.preview_count > p.sample_items.length && (
                        <li className="text-muted-foreground/70">… e mais {p.preview_count - p.sample_items.length}</li>
                      )}
                    </ul>
                  )}
                </div>

                {m.result && (
                  <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{m.result}</div>
                )}

                {!isDone && m.status === "pending" && p.preview_count > 0 && (
                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => cancel(i)}>
                      Cancelar
                    </Button>
                    <Button size="sm" className="h-7 text-[11px]" onClick={() => confirm(i, p)}>
                      Confirmar e aplicar
                    </Button>
                  </div>
                )}
                {m.status === "applying" && (
                  <div className="flex items-center justify-end gap-2 pt-1 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Aplicando…
                  </div>
                )}
                {!isDone && m.status === "pending" && p.preview_count === 0 && (
                  <div className="text-xs text-muted-foreground italic">
                    Nenhum item se encaixa nesse escopo — nada a fazer.
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Zeev está pensando…
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t bg-muted/20 p-2 space-y-1.5">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder='Ex.: "setor CC em todos sem setor identificado"'
          className="resize-none min-h-[56px] text-[13px]"
          disabled={busy}
        />
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setMessages([messages[0]])}
            className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            disabled={busy}
          >
            <RotateCcw className="h-3 w-3" /> limpar conversa
          </button>
          <Button size="sm" onClick={() => void send()} disabled={busy || !input.trim()} className="h-7 text-[11px]">
            <Send className="h-3 w-3 mr-1" /> Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}

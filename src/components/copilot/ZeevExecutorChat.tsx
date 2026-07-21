import { useState, useCallback, useRef, useEffect } from "react";
import { Send, Loader2, CheckCircle2, AlertCircle, RotateCcw, ArrowRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { ZeevIcon } from "./ZeevIcon";
import { ZeevResponseCard, type ZeevCard } from "./ZeevResponseCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getCurrentZeevContext } from "@/lib/zeevScreenContext";

type ExecAction =
  | "set_sector"
  | "set_cost_center"
  | "set_convenio"
  | "link_doctor_company"
  | "register_doctor_pending"
  | "register_company"
  | "resolve_registry_match"
  | "accept_keep_paid"
  | "accept_keep_expected"
  | "undo_accept"
  | "apply_manual_reason";
type SoftAction = "navigate" | "answer";
type Action = ExecAction | SoftAction;

type Proposal = {
  action: ExecAction;
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
  details?: Array<{ label: string; value: string }>;
};

type NavPayload = { url?: string; filter?: "zerados" | "divergentes" | "sem_regra" | "reprovados" };

type Msg =
  | { role: "user"; text: string }
  | { role: "zeev"; text: string; card?: ZeevCard | null }
  | { role: "navigate"; text: string; payload: NavPayload; done?: boolean }
  | { role: "proposal"; proposal: Proposal; status: "pending" | "confirmed" | "cancelled" | "applying"; result?: string };

const ACTION_LABEL: Record<ExecAction, string> = {
  set_sector: "Definir setor em lote",
  set_cost_center: "Definir centro de custos em lote",
  set_convenio: "Vincular convênio em lote",
  link_doctor_company: "Vincular médico → empresa",
  register_doctor_pending: "Cadastrar médico (pendente aprovação)",
  register_company: "Cadastrar empresa (PJ)",
  resolve_registry_match: "Registrar alias de cadastro",
  accept_keep_paid: "Acatar mantendo valor pago",
  accept_keep_expected: "Acatar mantendo valor esperado",
  undo_accept: "Desfazer acatamento em lote",
  apply_manual_reason: "Aplicar motivo de intervenção manual",
};

const REGISTRY_ACTIONS = new Set<ExecAction>(["register_doctor_pending", "register_company", "resolve_registry_match"]);

const FILTER_LABEL: Record<NonNullable<NavPayload["filter"]>, string> = {
  zerados: "valores zerados",
  divergentes: "itens divergentes",
  sem_regra: "itens sem regra",
  reprovados: "itens reprovados",
};

interface Props {
  /** Quando ausente, o chat funciona em modo livre: só navigate + answer. */
  paymentId?: string | null;
  /** Quando o usuário está na análise de UMA empresa do lote, escopa o contexto do Zeev. */
  companyGroupId?: string | null;
  companyName?: string | null;
  onApplied?: () => void;
  /** Aplica filtro do grid quando a página suporta. */
  onApplyFilter?: (filter: NonNullable<NavPayload["filter"]>) => void;
  /** Navega para uma URL absoluta. */
  onNavigateUrl?: (url: string) => void;
  /** Prompt inicial — quando muda (via nonce no key do componente), dispara propose automaticamente. */
  initialPrompt?: string;
}

export function ZeevExecutorChat({ paymentId, companyGroupId, companyName, onApplied, onApplyFilter, onNavigateUrl, initialPrompt }: Props) {
  const location = useLocation();
  const greeting = paymentId
    ? "Pode me perguntar sobre este pagamento, pedir pra ir a uma seção, ou ações em lote. Ex.: \"quantos itens estão zerados?\", \"me leva pros divergentes\", \"vincula os médicos sem PJ na empresa X\"."
    : "Pode me perguntar coisas ou pedir pra te levar a alguma tela. Ex.: \"abre os pagamentos\", \"vai pras regras\". Ações em lote precisam estar dentro de um lote.";

  const [messages, setMessages] = useState<Msg[]>([{ role: "zeev", text: greeting }]);
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
          body: {
            step: "propose",
            payment_id: paymentId ?? null,
            company_group_id: companyGroupId ?? null,
            company_name: companyName ?? null,
            current_path: location.pathname,
            prompt,
            screen_context: getCurrentZeevContext(),
          },
        });
        if (error) throw error;
        const r = data as
          | { step: "propose"; proposal: Proposal }
          | { step: "respond"; action: Action | "unsupported" | "clarify"; summary: string; payload?: NavPayload; card?: ZeevCard | null };
        if (r.step === "respond") {
          if (r.action === "navigate" && r.payload && (r.payload.url || r.payload.filter)) {
            setMessages((m) => [...m, { role: "navigate", text: r.summary, payload: r.payload! }]);
          } else {
            setMessages((m) => [...m, { role: "zeev", text: r.summary, card: r.card ?? null }]);
          }
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
    [paymentId, companyGroupId, companyName, location.pathname],
  );

  // Auto-dispara propose quando recebe initialPrompt (via key/nonce do pai).
  useEffect(() => {
    const t = (initialPrompt ?? "").trim();
    if (!t) return;
    setMessages((m) => [...m, { role: "user", text: t }]);
    void propose(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    await propose(text);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [input, busy, propose]);

  const applyNavigate = useCallback(
    (idx: number, payload: NavPayload) => {
      if (payload.filter && onApplyFilter) {
        onApplyFilter(payload.filter);
        toast.success(`Filtro "${FILTER_LABEL[payload.filter]}" aplicado.`);
      } else if (payload.url && onNavigateUrl) {
        onNavigateUrl(payload.url);
      } else if (payload.url) {
        window.location.href = payload.url;
      } else if (payload.filter) {
        toast.message("Esta tela não tem esse filtro disponível.");
        return;
      }
      setMessages((m) => m.map((msg, i) => (i === idx && msg.role === "navigate" ? { ...msg, done: true } : msg)));
    },
    [onApplyFilter, onNavigateUrl],
  );

  const confirm = useCallback(
    async (idx: number, proposal: Proposal) => {
      const isRegistry = REGISTRY_ACTIONS.has(proposal.action);
      if (!isRegistry && !paymentId) {
        toast.error("Sem pagamento ativo para executar.");
        return;
      }
      setMessages((m) => m.map((msg, i) => (i === idx && msg.role === "proposal" ? { ...msg, status: "applying" } : msg)));
      try {
        const { data, error } = await supabase.functions.invoke("zeev-executor", {
          body: { step: "execute", payment_id: paymentId ?? null, proposal },
        });
        if (error) throw error;
        const r = data as { affected: number; message: string };
        setMessages((m) =>
          m.map((msg, i) => (i === idx && msg.role === "proposal" ? { ...msg, status: "confirmed", result: r.message } : msg)),
        );
        toast.success(r.message);
        try { window.dispatchEvent(new CustomEvent("zeev:applied")); } catch { /* noop */ }
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
            const handleCardNav = (url: string) => {
              if (onNavigateUrl) onNavigateUrl(url);
              else window.location.href = url;
            };
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary mt-0.5">
                  <ZeevIcon className="h-3 w-3" />
                </div>
                {m.card ? (
                  <ZeevResponseCard card={m.card} onNavigate={handleCardNav} />
                ) : (
                  <div className="max-w-[85%] text-[13px] text-foreground leading-snug break-words whitespace-pre-wrap">{m.text}</div>
                )}
              </div>
            );
          }
          if (m.role === "navigate") {
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary mt-0.5">
                  <ZeevIcon className="h-3 w-3" />
                </div>
                <div className="flex-1 min-w-0 rounded-xl border border-primary/30 bg-primary-soft/30 p-3 space-y-2">
                  <p className="text-[13px] text-foreground leading-snug">{m.text}</p>
                  <div className="text-[11px] text-muted-foreground">
                    {m.payload.filter ? (
                      <>Filtro: <strong className="text-foreground">{FILTER_LABEL[m.payload.filter]}</strong></>
                    ) : m.payload.url ? (
                      <>Destino: <code className="text-foreground">{m.payload.url}</code></>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={m.done}
                      onClick={() => applyNavigate(i, m.payload)}
                    >
                      {m.done ? <CheckCircle2 className="h-3 w-3 mr-1" /> : <ArrowRight className="h-3 w-3 mr-1" />}
                      {m.done ? "Feito" : "Ir agora"}
                    </Button>
                  </div>
                </div>
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
                "flex-1 min-w-0 rounded-xl border p-3 space-y-2",
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
                {REGISTRY_ACTIONS.has(p.action) && p.details && p.details.length > 0 ? (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
                    {p.details.map((d, di) => (
                      <div key={di} className="contents">
                        <dt className="text-muted-foreground">{d.label}:</dt>
                        <dd className="text-foreground font-medium truncate">{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
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
                )}

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
          placeholder={paymentId
            ? 'Ex.: "me leva pros valores zerados"'
            : 'Ex.: "abre os pagamentos" ou "quantos lotes em aberto?"'}
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

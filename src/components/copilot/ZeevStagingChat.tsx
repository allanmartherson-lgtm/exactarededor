import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Send, Loader2, CheckCircle2, AlertCircle, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { REASON_LABELS, type SuspicionReason, type SuspiciousRow } from "@/lib/detectSuspiciousRows";
import { formatCurrency } from "@/lib/status";

/**
 * Zeev no staging (Novo Pagamento, pré-envio).
 *
 * Aqui não há payment_id. O front conhece o estado do lote (buckets/suspeitas)
 * e executa a ação localmente após confirmação. A edge function só interpreta
 * a frase do analista e devolve a intenção estruturada.
 *
 * V1: aplica decisões em lote nas linhas suspeitas (totalizadores/rodapé).
 * Outras ações (setor/CC/médico→PJ) só estão disponíveis depois do envio,
 * via tela de detalhe — o LLM é instruído a explicar isso.
 */

export type StagingDecision = "discard" | "informative_total" | "keep";

export interface StagingSuspiciousFile {
  fileName: string;
  rows: SuspiciousRow[];
}

export interface StagingContext {
  files: StagingSuspiciousFile[];
  /** Decisões já tomadas (chave fileName::rowNumber → decisão). */
  decisions: Record<string, StagingDecision>;
  /** Aplica decisões em lote. */
  applyDecisions: (changes: Array<{ fileName: string; rowNumber: number; decision: StagingDecision }>) => void;
}

const DECISION_LABEL: Record<StagingDecision, string> = {
  discard: "Descartar",
  informative_total: "Marcar como total informativo",
  keep: "Manter como item",
};

type Action = "decide_suspicious";
type Scope = { file_name?: string; reason?: SuspicionReason; all?: boolean };
type Payload = { decision?: StagingDecision };

interface Proposal {
  action: Action;
  scope: Scope;
  payload: Payload;
  summary: string;
  preview_count: number;
  sample: Array<{ fileName: string; rowNumber: number; value: number | null; reasons: SuspicionReason[] }>;
  affected: Array<{ fileName: string; rowNumber: number }>;
}

type Msg =
  | { role: "user"; text: string }
  | { role: "zeev"; text: string }
  | { role: "proposal"; proposal: Proposal; status: "pending" | "confirmed" | "cancelled" | "applying"; result?: string };

const decisionKey = (f: string, r: number) => `${f}::${r}`;

interface Props {
  staging: StagingContext;
}

export function ZeevStagingChat({ staging }: Props) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "zeev",
      text:
        "Posso te ajudar com as linhas suspeitas do lote. Ex.: \"descarta todos os totalizadores\", " +
        "\"marca como informativo as linhas com texto de NF do arquivo X\". Setor/CC/médico→PJ em lote " +
        "só ficam disponíveis depois que o lote for enviado, na tela do pagamento.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Conjunto de suspeitas pendentes (sem decisão ainda)
  const pending = useMemo(() => {
    const out: Array<{ fileName: string; row: SuspiciousRow }> = [];
    for (const f of staging.files) {
      for (const r of f.rows) {
        if (!staging.decisions[decisionKey(f.fileName, r.rowNumber)]) {
          out.push({ fileName: f.fileName, row: r });
        }
      }
    }
    return out;
  }, [staging.files, staging.decisions]);

  const buildProposal = useCallback(
    (action: Action, scope: Scope, payload: Payload, summary: string): Proposal => {
      const decision = payload.decision;
      if (!decision) {
        return {
          action,
          scope,
          payload,
          summary,
          preview_count: 0,
          sample: [],
          affected: [],
        };
      }
      const filtered = pending.filter(({ fileName, row }) => {
        if (scope.file_name && fileName.toLowerCase() !== scope.file_name.toLowerCase()) return false;
        if (scope.reason && !row.reasons.includes(scope.reason)) return false;
        return true;
      });
      return {
        action,
        scope,
        payload,
        summary,
        preview_count: filtered.length,
        sample: filtered.slice(0, 3).map(({ fileName, row }) => ({
          fileName,
          rowNumber: row.rowNumber,
          value: row.suspectedValue,
          reasons: row.reasons,
        })),
        affected: filtered.map(({ fileName, row }) => ({ fileName, rowNumber: row.rowNumber })),
      };
    },
    [pending],
  );

  const propose = useCallback(
    async (prompt: string) => {
      setBusy(true);
      try {
        const { data, error } = await supabase.functions.invoke("zeev-staging-executor", {
          body: {
            prompt,
            context: {
              file_names: staging.files.map((f) => f.fileName),
              suspicious_total: staging.files.reduce((s, f) => s + f.rows.length, 0),
              pending_total: pending.length,
              reasons_present: [...new Set(pending.flatMap(({ row }) => row.reasons))],
            },
          },
        });
        if (error) throw error;
        const r = data as {
          action: "decide_suspicious" | "unsupported" | "clarify";
          scope?: Scope;
          payload?: Payload;
          summary?: string;
        };

        if (r.action === "unsupported" || r.action === "clarify") {
          setMessages((m) => [...m, { role: "zeev", text: r.summary ?? "Não consegui interpretar." }]);
          return;
        }

        if (r.action === "decide_suspicious") {
          if (!r.payload?.decision) {
            setMessages((m) => [...m, { role: "zeev", text: "Qual decisão? (descartar / informativo / manter)" }]);
            return;
          }
          const proposal = buildProposal("decide_suspicious", r.scope ?? {}, r.payload, r.summary ?? "");
          setMessages((m) => [...m, { role: "proposal", proposal, status: "pending" }]);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) => [...m, { role: "zeev", text: `Não consegui processar: ${msg}` }]);
      } finally {
        setBusy(false);
      }
    },
    [staging.files, pending, buildProposal],
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
    (idx: number, p: Proposal) => {
      if (!p.payload.decision || p.affected.length === 0) return;
      setMessages((m) => m.map((msg, i) => (i === idx && msg.role === "proposal" ? { ...msg, status: "applying" } : msg)));
      try {
        staging.applyDecisions(
          p.affected.map((a) => ({ fileName: a.fileName, rowNumber: a.rowNumber, decision: p.payload.decision! })),
        );
        const message = `Aplicado em ${p.affected.length} ${p.affected.length === 1 ? "linha" : "linhas"}.`;
        setMessages((m) =>
          m.map((msg, i) => (i === idx && msg.role === "proposal" ? { ...msg, status: "confirmed", result: message } : msg)),
        );
        toast.success(message);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setMessages((m) => m.map((message, i) => (i === idx && message.role === "proposal" ? { ...message, status: "pending" } : message)));
        toast.error(`Falha ao aplicar: ${msg}`);
      }
    },
    [staging],
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
            return (
              <div key={i} className="flex items-start gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary mt-0.5">
                  <Sparkles className="h-3 w-3" />
                </div>
                <div className="max-w-[85%] text-[13px] text-foreground leading-snug break-words">{m.text}</div>
              </div>
            );
          }
          const p = m.proposal;
          const isDone = m.status === "confirmed" || m.status === "cancelled";
          const decisionLabel = p.payload.decision ? DECISION_LABEL[p.payload.decision] : "—";
          return (
            <div key={i} className="flex items-start gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary mt-0.5">
                <Sparkles className="h-3 w-3" />
              </div>
              <div className={cn(
                "flex-1 rounded-xl border p-3 space-y-2",
                m.status === "confirmed" && "border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20",
                m.status === "cancelled" && "border-border bg-muted/40 opacity-70",
                (m.status === "pending" || m.status === "applying") && "border-primary/30 bg-primary-soft/30",
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    Decidir suspeitas em lote · {decisionLabel}
                  </div>
                  {m.status === "confirmed" && <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />}
                  {m.status === "cancelled" && <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0" />}
                </div>
                <p className="text-[13px] text-foreground leading-snug">{p.summary}</p>
                <div className="flex flex-wrap gap-1">
                  {p.scope.file_name && (
                    <Badge variant="outline" className="h-4 text-[10px]">arquivo: {p.scope.file_name}</Badge>
                  )}
                  {p.scope.reason && (
                    <Badge variant="outline" className="h-4 text-[10px]">{REASON_LABELS[p.scope.reason]}</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{p.preview_count}</strong> {p.preview_count === 1 ? "linha afetada" : "linhas afetadas"}
                  {p.sample.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-[11px]">
                      {p.sample.map((s) => (
                        <li key={`${s.fileName}-${s.rowNumber}`} className="truncate">
                          • {s.fileName} · linha {s.rowNumber}
                          {s.value != null && <> · {formatCurrency(s.value)}</>}
                        </li>
                      ))}
                      {p.preview_count > p.sample.length && (
                        <li className="text-muted-foreground/70">… e mais {p.preview_count - p.sample.length}</li>
                      )}
                    </ul>
                  )}
                </div>

                {m.result && <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{m.result}</div>}

                {!isDone && m.status === "pending" && p.preview_count > 0 && (
                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => cancel(i)}>Cancelar</Button>
                    <Button size="sm" className="h-7 text-[11px]" onClick={() => confirm(i, p)}>Confirmar e aplicar</Button>
                  </div>
                )}
                {m.status === "applying" && (
                  <div className="flex items-center justify-end gap-2 pt-1 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Aplicando…
                  </div>
                )}
                {!isDone && m.status === "pending" && p.preview_count === 0 && (
                  <div className="text-xs text-muted-foreground italic">Nenhuma linha pendente se encaixa nesse escopo.</div>
                )}
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Zeev está pensando…
          </div>
        )}
      </div>

      <div className="border-t bg-muted/20 p-2 space-y-1.5">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); }
          }}
          placeholder='Ex.: "descarta todos os totalizadores"'
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

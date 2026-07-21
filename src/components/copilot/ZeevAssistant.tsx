import { useMemo, useState, useEffect, useCallback } from "react";

import { X, ChevronRight, AlertTriangle, GitBranch, ShieldQuestion, Loader2, Users, Lightbulb, Send } from "lucide-react";
import { ZeevIcon } from "./ZeevIcon";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ZeevBulkManualDialog, type ZeevBulkItem } from "./ZeevBulkManualDialog";
import { ZeevSuggestRuleDialog } from "./ZeevSuggestRuleDialog";
import { ZeevExecutorChat } from "./ZeevExecutorChat";
import { ZeevStagingChat, type StagingContext } from "./ZeevStagingChat";
import { ZeevDiagnosticCard } from "./ZeevDiagnosticCard";
import { ZeevRetroactiveGapsCard } from "./ZeevRetroactiveGapsCard";

/**
 * Zeev — mascote assistente do Exacta.
 *
 * Princípio: SEMPRE presente, NUNCA poluindo.
 * - Idle: bolinha 36px translúcida no canto, sem texto, sem badge.
 * - Com insights: expande para pill com contagem e pulsa de leve.
 * - Ao clicar: abre painel com sinais detectados + dica conversacional gerada por IA.
 *
 * Não altera dados — só observa, comenta e oferece atalhos para o analista agir.
 */

type ZeevItem = {
  id: string;
  ai_status?: string | null;
  doctor_name?: string | null;
  procedure_code?: string | null;
  procedure_description?: string | null;
  attendance_number?: string | null;
  applied_calc_method?: string | null;
  applied_rule_id?: string | null;
  manual_intervention_reason_id?: string | null;
  gross_amount?: number | null;
  expected_amount?: number | null;
  procedure_amount?: number | null;
  ai_findings?: { needs_human_review?: boolean } | Record<string, unknown> | null;
};

export type ZeevBulkPayload = {
  /** Itens a tratar em lote. */
  itemIds: string[];
  /** Subtítulo do diálogo de confirmação. */
  subtitle?: string;
};

export type ZeevSuggestPayload = {
  /** Médico (quando o padrão é específico) ou null se múltiplos. */
  doctor_name?: string | null;
  doctor_id?: string | null;
  procedure_code?: string | null;
  procedure_description?: string | null;
  occurrences?: number;
  sample_item_ids: string[];
  context?: Record<string, unknown>;
  initialJustification?: string;
};

export type ZeevInlineAction = {
  id: string;
  label: string;
  /** Texto opcional acima da grade (ex.: "Aplicar em 3 arquivos:"). */
  hint?: string;
  onClick: () => void;
  tone?: "primary" | "outline";
};

export type ZeevInsight = {
  id: string;
  priority: "alta" | "media" | "baixa";
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Quando presente, Zeev oferece "Tratar em lote" e abre o diálogo de preview. */
  bulk?: ZeevBulkPayload;
  /** Quando presente, Zeev oferece "Sugerir regra" e abre o diálogo de sugestão. */
  suggestRule?: ZeevSuggestPayload;
  /** Quando presente, Zeev troca pra aba "Conversar" e pré-preenche essa frase. */
  chatPrompt?: string;
  /** Label do botão que dispara o chatPrompt. Default: "Resolver com o Zeev". */
  chatActionLabel?: string;
  /** Botões de aplicação direta — clique já executa (com toast). Sem chat, sem digitar. */
  inlineActions?: ZeevInlineAction[];
  /** Texto opcional acima da grade de inlineActions. */
  inlineActionsHint?: string;
};

interface Props {
  /** Rótulo da tela atual — usado pela IA pra personalizar a dica. */
  pageLabel: string;
  /** Resumo numérico/contextual da tela (ex.: { total: 159, divergentes: 29 }). */
  summary?: Record<string, unknown>;
  /** Itens de pagamento (opcional) — quando passados, Zeev calcula insights automáticos. */
  items?: ZeevItem[];
  /** Insights extras já calculados pela própria página. */
  extraInsights?: ZeevInsight[];
  /** Filtro sugerido pelo Zeev (deep link nos filtros do grid). */
  onApplyFilter?: (filter: "divergentes" | "sem_regra" | "reprovados" | "zerados") => void;
  /** Contexto necessário pra ações em lote (paymentId + companyName + companyGroupId opcional pra sugestões). */
  bulkContext?: { paymentId: string; companyName: string | null; companyGroupId?: string | null; companyId?: string | null };
  /** Callback chamado após o Zeev aplicar uma ação em lote. Recebe (opcional) as linhas
   * já reconciliadas do DB para permitir sync imediato da UI sem esperar realtime. */
  onBulkApplied?: (payload?: { itemIds: string[]; rows: Array<Record<string, unknown>> }) => void;
  /** Posicionamento (default: bottom-left). */
  side?: "bottom-left" | "bottom-right";
  /**
   * Habilita as ações inteligentes do Zeev (tratativa manual em lote + sugerir regra).
   * Default: false. Hoje só faz sentido em pagamentos de parecer — em outros tipos,
   * o Zeev fica como dica/insight informativo, sem oferecer os botões de ação.
   */
  smartActionsEnabled?: boolean;
  /**
   * Quando definido, habilita o Zeev Executor sobre o LOTE EM CONSTRUÇÃO (pré-envio).
   * Mutuamente exclusivo com bulkContext (que é pós-envio).
   */
  stagingContext?: StagingContext;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");

function buildItemInsights(items: ZeevItem[], onApplyFilter?: Props["onApplyFilter"]): ZeevInsight[] {
  const out: ZeevInsight[] = [];
  const total = items.length;
  if (total === 0) return out;

  const divergentes = items.filter(
    (i) =>
      (i.ai_status === "reprovado" || i.ai_status === "alerta") &&
      !i.manual_intervention_reason_id,
  );
  const pctDiv = divergentes.length / total;
  if (divergentes.length >= 5 && pctDiv >= 0.1) {
    out.push({
      id: "muitos-divergentes",
      priority: pctDiv >= 0.3 ? "alta" : "media",
      icon: AlertTriangle,
      title: `${divergentes.length} itens divergentes`,
      message: `${Math.round(pctDiv * 100)}% dos itens estão reprovado/alerta sem tratativa manual. Posso aplicar a mesma justificativa em todos de uma vez.`,
      actionLabel: onApplyFilter ? "Filtrar no grid" : undefined,
      onAction: onApplyFilter ? () => onApplyFilter("divergentes") : undefined,
      bulk: {
        itemIds: divergentes.map((i) => i.id),
        subtitle: `Zeev encontrou ${divergentes.length} itens divergentes sem tratativa. Selecione os que devem receber a mesma justificativa em lote.`,
      },
    });
  }

  const groupBuckets = new Map<
    string,
    { doctor: string; tuss: string; items: ZeevItem[] }
  >();
  for (const it of items) {
    if (it.ai_status !== "reprovado") continue;
    if (it.manual_intervention_reason_id) continue;
    const k = `${norm(it.doctor_name)}|${norm(it.procedure_code)}`;
    if (k === "|") continue;
    const prev = groupBuckets.get(k);
    if (prev) prev.items.push(it);
    else
      groupBuckets.set(k, {
        doctor: it.doctor_name ?? "—",
        tuss: it.procedure_code ?? "—",
        items: [it],
      });
  }
  const repeated = [...groupBuckets.values()]
    .filter((g) => g.items.length >= 3)
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, 3);
  for (const g of repeated) {
    out.push({
      id: `padrao-${g.doctor}-${g.tuss}`,
      priority: g.items.length >= 5 ? "alta" : "media",
      icon: GitBranch,
      title: `Padrão repetido (${g.items.length}× reprovado)`,
      message: `${g.doctor} · TUSS ${g.tuss} reprovou ${g.items.length}× — provavelmente cabe a mesma justificativa em todos, ou uma regra nova.`,
      bulk: {
        itemIds: g.items.map((i) => i.id),
        subtitle: `${g.items.length} reprovações de ${g.doctor} no TUSS ${g.tuss}. Aplicar a mesma tratativa manual nos selecionados?`,
      },
      suggestRule: {
        doctor_name: g.doctor,
        procedure_code: g.tuss,
        sample_item_ids: g.items.map((i) => i.id),
        occurrences: g.items.length,
        context: { trigger: "padrao_repetido" },
        initialJustification: `${g.doctor} reprovou ${g.items.length}× no TUSS ${g.tuss} nesta competência. Sugiro avaliar uma regra específica pra esse caso.`,
      },
    });
  }

  // Usa o MESMO critério do filtro "Sem regra" do grid (ItemsDataGrid):
  // ai_findings.needs_human_review === true. Garante que o número que o Zeev
  // mostra bata exatamente com o contador do botão de filtro.
  const semRegra = items.filter(
    (i) => !!(i.ai_findings as { needs_human_review?: boolean } | null)?.needs_human_review,
  );
  if (semRegra.length >= 3) {
    out.push({
      id: "sem-regra",
      priority: semRegra.length >= 10 ? "alta" : "media",
      icon: ShieldQuestion,
      title: `${semRegra.length} itens sem regra cadastrada`,
      message: `Esses itens não tiveram repasse calculado. Você pode sugerir regra nova ao diretor ou tratar manualmente em lote.`,
      bulk: {
        itemIds: semRegra.map((i) => i.id),
        subtitle: `${semRegra.length} itens sem regra cadastrada. Marcar todos como tratativa manual (aceita o valor do convênio)?`,
      },
      suggestRule: {
        sample_item_ids: semRegra.slice(0, 30).map((i) => i.id),
        occurrences: semRegra.length,
        context: { trigger: "sem_regra", total: semRegra.length },
        initialJustification: `Identifiquei ${semRegra.length} itens sem regra cadastrada nessa competência. Vale a pena revisar o cadastro pra eles passarem a ser calculados automaticamente.`,
      },
    });
  }

  const inconsistentes = items.filter(
    (i) => i.manual_intervention_reason_id && i.ai_status !== "aprovado",
  );
  if (inconsistentes.length > 0) {
    out.push({
      id: "inconsistencias",
      priority: "alta",
      icon: AlertTriangle,
      title: `${inconsistentes.length} inconsistência(s) de status`,
      message: `Itens com tratativa manual deveriam estar APROVADOS. A correção automática roda ao recarregar.`,
    });
  }

  return out;
}

const PRIORITY_STYLE: Record<ZeevInsight["priority"], string> = {
  alta: "border-rose-300 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30",
  media: "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
  baixa: "border-sky-300 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30",
};

const HIDDEN_KEY = "zeev-dismissed-insights";

export function ZeevAssistant({
  pageLabel,
  summary,
  items,
  extraInsights,
  onApplyFilter,
  bulkContext,
  onBulkApplied,
  side = "bottom-left",
  smartActionsEnabled = false,
  stagingContext,
}: Props) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(HIDDEN_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [aiTip, setAiTip] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [bulkOpen, setBulkOpen] = useState<ZeevInsight | null>(null);
  const [suggestOpen, setSuggestOpen] = useState<ZeevInsight | null>(null);
  const [tab, setTab] = useState<"insights" | "chat">("insights");
  const [chatInitialPrompt, setChatInitialPrompt] = useState<{ text: string; nonce: number } | null>(null);
  const executorEnabled = true; // chat sempre disponível; modo livre quando não há contexto
  const stagingMode = !!stagingContext && !bulkContext?.paymentId;

  const insights = useMemo<ZeevInsight[]>(() => {
    const auto = items ? buildItemInsights(items, onApplyFilter) : [];
    const merged: ZeevInsight[] = [...(extraInsights ?? []), ...auto];
    if (!smartActionsEnabled) {
      return merged.map((i) => ({ ...i, bulk: undefined, suggestRule: undefined }));
    }
    return merged;
  }, [items, extraInsights, onApplyFilter, smartActionsEnabled]);

  const visible = insights.filter((i) => !dismissed.has(i.id));
  const highPriority = visible.filter((i) => i.priority === "alta").length;
  const hasInsights = visible.length > 0;

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try {
      sessionStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
    } catch {
      /* noop */
    }
  };

  const fetchTip = useCallback(async () => {
    setAiLoading(true);
    try {
      const signals = visible.map((i) => ({ priority: i.priority, title: i.title }));
      const { data, error } = await supabase.functions.invoke("ai-copilot", {
        body: {
          task: "zeev_tip",
          context: { page_label: pageLabel, summary: summary ?? {}, signals },
        },
      });
      if (error) {
        setAiTip(null);
        return;
      }
      const r = (data as { result?: { text?: string } })?.result;
      setAiTip(r?.text ?? null);
    } catch {
      setAiTip(null);
    } finally {
      setAiLoading(false);
    }
  }, [pageLabel, summary, visible]);

  useEffect(() => {
    if (open && !aiTip && !aiLoading) {
      void fetchTip();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // reset AI tip quando a página muda (pageLabel)
  useEffect(() => {
    setAiTip(null);
  }, [pageLabel]);

  const sideClass = side === "bottom-right" ? "bottom-6 right-24" : "bottom-6 left-6";

  return (
    <div className={cn("fixed z-40", sideClass)}>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Zeev — assistente"
                  className={cn(
                    "group relative flex items-center gap-2 rounded-full shadow-lg transition-all",
                    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
                    "ring-1 ring-[hsl(var(--primary-dark))]/40",
                    "hover:scale-105 hover:shadow-xl hover:bg-[hsl(var(--primary-dark))]",
                    hasInsights ? "pl-2 pr-3 py-2 opacity-100" : "h-9 w-9 justify-center opacity-80 hover:opacity-100",
                  )}
                >
                  <div
                    className={cn(
                      "relative flex items-center justify-center rounded-full",
                      hasInsights ? "h-8 w-8 bg-white/15 backdrop-blur" : "h-full w-full",
                    )}
                  >
                    <ZeevIcon className="h-5 w-5 text-white" />
                    {hasInsights && (
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-[hsl(var(--primary-dark))]">
                        {visible.length}
                      </span>
                    )}
                  </div>
                  {hasInsights && (
                    <div className="flex flex-col items-start leading-tight">
                      <span className="text-[10px] uppercase tracking-wider opacity-80">Zeev</span>
                      <span className="text-xs font-medium">
                        {highPriority > 0 ? `${highPriority} urgente(s)` : "tem sugestões"}
                      </span>
                    </div>
                  )}
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            {!open && (
              <TooltipContent side="right" className="text-xs">
                {hasInsights ? "Zeev tem sugestões pra você" : "Falar com o Zeev"}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>

        <PopoverContent
          side="top"
          align={side === "bottom-right" ? "end" : "start"}
          sideOffset={12}
          className="w-[400px] max-w-[calc(100vw-2rem)] p-0 overflow-hidden rounded-2xl border-[hsl(var(--primary))]/20 shadow-2xl"
        >
          {/* Cabeçalho */}
          <div className="relative bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(var(--primary))] to-[hsl(var(--primary-dark))] px-4 py-3.5 text-[hsl(var(--primary-foreground))]">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                <ZeevIcon className="h-5 w-5 text-white" />
              </div>

              <div className="flex-1 min-w-0 pr-6">
                <div className="text-sm font-semibold leading-tight">Oi, sou o Zeev 👋</div>
                <div
                  className="text-[11px] opacity-90 leading-snug mt-0.5 break-words"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                  title={pageLabel}
                >
                  {pageLabel}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                className="absolute top-2.5 right-2.5 h-6 w-6 text-[hsl(var(--primary-foreground))] hover:bg-white/15"
                onClick={() => setOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Tabs (só aparece quando o executor está disponível) */}
          {executorEnabled && (
            <div className="flex border-b border-border/60 bg-muted/20 px-2 pt-2">
              <button
                type="button"
                onClick={() => setTab("insights")}
                className={cn(
                  "flex-1 text-[11px] font-medium px-3 py-2 rounded-t-md transition-colors",
                  tab === "insights"
                    ? "bg-background text-foreground border-t border-l border-r border-border/60 -mb-px"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Apoio analítico
              </button>
              <button
                type="button"
                onClick={() => setTab("chat")}
                className={cn(
                  "flex-1 text-[11px] font-medium px-3 py-2 rounded-t-md transition-colors inline-flex items-center justify-center gap-1.5",
                  tab === "chat"
                    ? "bg-background text-foreground border-t border-l border-r border-border/60 -mb-px"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Conversar
                <Badge variant="secondary" className="h-3.5 text-[8px] px-1 font-bold uppercase">beta</Badge>
              </button>
            </div>
          )}

          {/* === ABA: APOIO ANALÍTICO === */}
          {tab === "insights" && (
            <>
              {/* Pre-flight do lote (Fase 1 — Zeev v2) */}
              {bulkContext?.paymentId && (
                <div className="px-3 pt-3">
                  <ZeevDiagnosticCard
                    paymentId={bulkContext.paymentId}
                    companyId={bulkContext.companyId ?? null}
                    companyName={bulkContext.companyName ?? null}
                    onActed={() => setOpen(false)}
                    onSendChatPrompt={(text) => {
                      setTab("chat");
                      setChatInitialPrompt({ text, nonce: Date.now() });
                    }}
                  />
                </div>
              )}

              {/* Gaps retroativos (Fase 3.2 — só fora do contexto de lote) */}
              {!bulkContext?.paymentId && !stagingMode && (
                <div className="px-3 pt-3">
                  <ZeevRetroactiveGapsCard onActed={() => setOpen(false)} />
                </div>
              )}
              {/* IA conversacional */}
              <div className="px-3 pt-3">
                <div className="rounded-xl border border-[hsl(var(--primary))]/15 bg-[hsl(var(--primary-soft))]/60 dark:bg-[hsl(var(--primary-soft))]/30 p-3">
                  {aiLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Pensando…
                    </div>
                  ) : aiTip ? (
                    <p className="text-[13px] leading-relaxed text-foreground break-words hyphens-auto">
                      {aiTip}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void fetchTip()}
                      className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                    >
                      Pedir uma dica para esta tela →
                    </button>
                  )}
                  <div className="text-[9px] text-muted-foreground italic mt-1.5 uppercase tracking-wider">
                    IA · apoio analítico
                  </div>
                </div>
              </div>

              {/* Separador discreto */}
              <div className="px-3 pt-3">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Sinais detectados</span>
                  <div className="flex-1 h-px bg-border" />
                  {visible.length > 0 && (
                    <span className="text-foreground/60">{visible.length}</span>
                  )}
                </div>
              </div>

              {/* Sinais determinísticos */}
              <div className="max-h-[44vh] overflow-y-auto p-3 pt-2 space-y-2">
                {visible.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-4 px-2 leading-relaxed">
                    Sem alertas por aqui. Estou de olho — se algo aparecer, eu aviso.
                  </div>
                )}
                {visible.map((ins) => {
                  const Icon = ins.icon ?? ((props: { className?: string }) => <ZeevIcon variant="mark" className={props.className} />);
                  return (
                    <div
                      key={ins.id}
                      className={cn(
                        "rounded-xl border p-3 space-y-2.5 transition-shadow hover:shadow-sm",
                        PRIORITY_STYLE[ins.priority],
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background/80 ring-1 ring-border/50">
                          <Icon className="h-3.5 w-3.5 text-foreground/70" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-semibold leading-snug break-words hyphens-auto text-foreground">
                              {ins.title}
                            </p>
                            <Badge
                              variant="outline"
                              className="text-[9px] h-4 px-1.5 capitalize shrink-0 mt-0.5 bg-background/60"
                            >
                              {ins.priority}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed break-words hyphens-auto">
                            {ins.message}
                          </p>
                        </div>
                      </div>
                      {ins.inlineActions && ins.inlineActions.length > 0 && (
                        <div className="space-y-1.5">
                          {ins.inlineActionsHint && (
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                              {ins.inlineActionsHint}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {ins.inlineActions.map((a) => (
                              <Button
                                key={a.id}
                                size="sm"
                                variant={a.tone === "primary" ? "default" : "outline"}
                                onClick={() => { a.onClick(); }}
                                className="h-7 text-[11px]"
                              >
                                {a.label}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-1 pt-0.5 border-t border-border/40 -mx-3 px-3 pt-2 flex-wrap">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => dismiss(ins.id)}
                          className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Dispensar
                        </Button>
                        {ins.actionLabel && ins.onAction && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              ins.onAction?.();
                              setOpen(false);
                            }}
                            className="h-7 text-[11px]"
                          >
                            {ins.actionLabel}
                            <ChevronRight className="h-3 w-3 ml-1" />
                          </Button>
                        )}
                        {ins.chatPrompt && executorEnabled && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setChatInitialPrompt({ text: ins.chatPrompt!, nonce: Date.now() });
                              setTab("chat");
                            }}
                            className="h-7 text-[11px] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
                          >
                            <ZeevIcon variant="mark" className="h-3 w-3 mr-1" />
                            {ins.chatActionLabel ?? "Resolver com o Zeev"}
                          </Button>
                        )}
                        {ins.suggestRule && bulkContext && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSuggestOpen(ins);
                              setOpen(false);
                            }}
                            className="h-7 text-[11px]"
                          >
                            <Lightbulb className="h-3 w-3 mr-1" />
                            Sugerir regra
                          </Button>
                        )}
                        {ins.bulk && bulkContext && ins.bulk.itemIds.length > 0 && (
                          <Button
                            size="sm"
                            onClick={() => {
                              setBulkOpen(ins);
                              setOpen(false);
                            }}
                            className="h-7 text-[11px] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
                          >
                            <Users className="h-3 w-3 mr-1" />
                            Tratar {ins.bulk.itemIds.length} em lote
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <QuickAskInput
                onSubmit={(text) => {
                  setChatInitialPrompt({ text, nonce: Date.now() });
                  setTab("chat");
                }}
              />

              <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground italic bg-muted/40">
                Zeev observa padrões — nada é alterado sem você confirmar.
              </div>
            </>
          )}

          {/* === ABA: CONVERSAR (EXECUTOR) === */}
          {tab === "chat" && executorEnabled && (
            <>
              {stagingMode && stagingContext ? (
                <ZeevStagingChat
                  key={chatInitialPrompt?.nonce ?? "default"}
                  staging={stagingContext}
                  initialPrompt={chatInitialPrompt?.text}
                />
              ) : (
                <ZeevExecutorChat
                  key={chatInitialPrompt?.nonce ?? "default"}
                  paymentId={bulkContext?.paymentId ?? null}
                  companyGroupId={bulkContext?.companyGroupId ?? null}
                  companyName={bulkContext?.companyName ?? null}
                  initialPrompt={chatInitialPrompt?.text}
                  onApplied={onBulkApplied}
                  onApplyFilter={onApplyFilter}
                  onNavigateUrl={(url) => { window.location.assign(url); }}
                />
              )}
              <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground italic bg-muted/40">
                Zeev sempre pede sua confirmação antes de aplicar.
              </div>
            </>
          )}


        </PopoverContent>
      </Popover>

      {bulkOpen && bulkContext && bulkOpen.bulk && (
        <ZeevBulkManualDialog
          open={!!bulkOpen}
          onOpenChange={(v) => !v && setBulkOpen(null)}
          paymentId={bulkContext.paymentId}
          companyName={bulkContext.companyName}
          title={bulkOpen.title}
          subtitle={bulkOpen.bulk.subtitle}
          items={(items ?? [])
            .filter((it) => bulkOpen.bulk!.itemIds.includes(it.id))
            .map<ZeevBulkItem>((it) => ({
              id: it.id,
              doctor_name: it.doctor_name,
              procedure_code: it.procedure_code,
              procedure_description: it.procedure_description,
              attendance_number: it.attendance_number,
              procedure_amount: it.procedure_amount,
            }))}
          onApplied={(payload) => {
            setBulkOpen(null);
            onBulkApplied?.(payload);
          }}
        />
      )}

      {suggestOpen && bulkContext && suggestOpen.suggestRule && (
        <ZeevSuggestRuleDialog
          open={!!suggestOpen}
          onOpenChange={(v) => !v && setSuggestOpen(null)}
          paymentId={bulkContext.paymentId}
          companyGroupId={bulkContext.companyGroupId ?? null}
          payload={suggestOpen.suggestRule}
          onSubmitted={() => setSuggestOpen(null)}
        />
      )}
    </div>
  );
}



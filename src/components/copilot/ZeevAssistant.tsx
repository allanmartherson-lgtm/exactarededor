import { useMemo, useState, useEffect, useCallback } from "react";
import { Sparkles, X, ChevronRight, AlertTriangle, GitBranch, ShieldQuestion, Wand2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

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
  applied_calc_method?: string | null;
  applied_rule_id?: string | null;
  manual_intervention_reason_id?: string | null;
  gross_amount?: number | null;
  expected_amount?: number | null;
  procedure_amount?: number | null;
};

export type ZeevInsight = {
  id: string;
  priority: "alta" | "media" | "baixa";
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
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
  onApplyFilter?: (filter: "divergentes" | "sem_regra" | "reprovados") => void;
  /** Posicionamento (default: bottom-left). */
  side?: "bottom-left" | "bottom-right";
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
      message: `${Math.round(pctDiv * 100)}% dos itens estão reprovado/alerta sem tratativa manual. Quer filtrar pra revisar em bloco?`,
      actionLabel: onApplyFilter ? "Filtrar divergentes" : undefined,
      onAction: onApplyFilter ? () => onApplyFilter("divergentes") : undefined,
    });
  }

  const groupCounts = new Map<string, { count: number; doctor: string; tuss: string }>();
  for (const it of items) {
    if (it.ai_status !== "reprovado") continue;
    if (it.manual_intervention_reason_id) continue;
    const k = `${norm(it.doctor_name)}|${norm(it.procedure_code)}`;
    if (k === "|") continue;
    const prev = groupCounts.get(k);
    if (prev) prev.count += 1;
    else groupCounts.set(k, { count: 1, doctor: it.doctor_name ?? "—", tuss: it.procedure_code ?? "—" });
  }
  const repeated = [...groupCounts.values()].filter((g) => g.count >= 3).sort((a, b) => b.count - a.count).slice(0, 3);
  for (const g of repeated) {
    out.push({
      id: `padrao-${g.doctor}-${g.tuss}`,
      priority: g.count >= 5 ? "alta" : "media",
      icon: GitBranch,
      title: `Padrão repetido (${g.count}× reprovado)`,
      message: `${g.doctor} · TUSS ${g.tuss} reprovou ${g.count}× — provavelmente cabe a mesma justificativa.`,
    });
  }

  const semRegra = items.filter(
    (i) => i.applied_calc_method === "sem_regra" || (!i.applied_rule_id && !i.applied_calc_method),
  );
  if (semRegra.length >= 3) {
    out.push({
      id: "sem-regra",
      priority: semRegra.length >= 10 ? "alta" : "media",
      icon: ShieldQuestion,
      title: `${semRegra.length} itens sem regra cadastrada`,
      message: `Esses itens não tiveram repasse calculado. Vale revisar o cadastro de regras ou tratar manualmente.`,
      actionLabel: onApplyFilter ? "Ver sem regra" : undefined,
      onAction: onApplyFilter ? () => onApplyFilter("sem_regra") : undefined,
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
  side = "bottom-left",
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

  const insights = useMemo(() => {
    const auto = items ? buildItemInsights(items, onApplyFilter) : [];
    return [...(extraInsights ?? []), ...auto];
  }, [items, extraInsights, onApplyFilter]);

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
                    "bg-gradient-to-br from-violet-600 via-fuchsia-600 to-purple-700 text-white",
                    "hover:scale-105 hover:shadow-xl",
                    hasInsights ? "pl-2 pr-3 py-2 opacity-100" : "h-9 w-9 justify-center opacity-70 hover:opacity-100",
                  )}
                >
                  <div
                    className={cn(
                      "relative flex items-center justify-center rounded-full",
                      hasInsights ? "h-8 w-8 bg-white/15 backdrop-blur" : "h-full w-full",
                    )}
                  >
                    <Sparkles className={cn(hasInsights ? "h-4 w-4" : "h-4 w-4")} />
                    {hasInsights && (
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold ring-2 ring-purple-700">
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
          className="w-[380px] p-0 overflow-hidden border-purple-200 dark:border-purple-900"
        >
          <div className="bg-gradient-to-br from-violet-600 via-fuchsia-600 to-purple-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <Wand2 className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">Oi, sou o Zeev 👋</div>
                <div className="text-[11px] opacity-90 truncate">
                  {pageLabel}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-white hover:bg-white/15"
                onClick={() => setOpen(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* IA conversacional */}
          <div className="px-3 pt-3">
            <div className="rounded-lg border border-purple-200/70 dark:border-purple-900/60 bg-purple-50/40 dark:bg-purple-950/20 p-2.5">
              {aiLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Pensando…
                </div>
              ) : aiTip ? (
                <p className="text-xs leading-relaxed text-foreground/90">{aiTip}</p>
              ) : (
                <button
                  type="button"
                  onClick={() => void fetchTip()}
                  className="text-xs text-purple-700 dark:text-purple-300 hover:underline"
                >
                  Pedir uma dica para esta tela
                </button>
              )}
              <div className="text-[9px] text-muted-foreground italic mt-1">IA · apoio analítico</div>
            </div>
          </div>

          {/* Sinais determinísticos */}
          <div className="max-h-[50vh] overflow-y-auto p-3 space-y-2">
            {visible.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-4">
                Sem alertas por aqui. Estou de olho — se algo aparecer, eu aviso.
              </div>
            )}
            {visible.map((ins) => {
              const Icon = ins.icon ?? Sparkles;
              return (
                <div
                  key={ins.id}
                  className={cn("rounded-lg border p-3 space-y-2", PRIORITY_STYLE[ins.priority])}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="h-4 w-4 mt-0.5 shrink-0 text-foreground/70" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium leading-tight">{ins.title}</p>
                        <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize shrink-0">
                          {ins.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{ins.message}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismiss(ins.id)}
                      className="h-7 text-[11px] text-muted-foreground"
                    >
                      Dispensar
                    </Button>
                    {ins.actionLabel && ins.onAction && (
                      <Button
                        size="sm"
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
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground italic bg-muted/30">
            Zeev observa padrões — nada é alterado sem você confirmar.
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

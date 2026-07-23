import { useMemo, useState, useEffect } from "react";

import { X, AlertTriangle, GitBranch, ShieldQuestion, Users, Lightbulb, MessageCircle, ArrowLeft, MapPin, Building2 } from "lucide-react";
import { ZeevIcon } from "./ZeevIcon";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { ZeevBulkManualDialog, type ZeevBulkItem } from "./ZeevBulkManualDialog";
import { ZeevSuggestRuleDialog } from "./ZeevSuggestRuleDialog";
import { ZeevExecutorChat } from "./ZeevExecutorChat";
import { ZeevStagingChat, type StagingContext } from "./ZeevStagingChat";
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

const PRIORITY_DOT: Record<ZeevInsight["priority"], string> = {
  alta: "bg-rose-500",
  media: "bg-amber-500",
  baixa: "bg-sky-500",
};
const PRIORITY_LABEL: Record<ZeevInsight["priority"], string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Info",
};
const PRIORITY_WEIGHT: Record<ZeevInsight["priority"], number> = {
  alta: 3,
  media: 2,
  baixa: 1,
};

const HIDDEN_KEY = "zeev-dismissed-insights";

/** Insight derivado do pre-flight (contagens do lote/empresa). */
type DiagBucket = {
  topic: "sem_setor" | "sem_cc" | "sem_empresa" | "sem_regra" | "divergentes" | "zerados";
  count: number;
};

type DiagCounts = {
  total: number;
  sem_setor: number;
  sem_cc: number;
  sem_empresa: number;
  sem_regra: number;
  divergentes: number;
  zerados: number;
};

/**
 * Busca o pré-flight da empresa/lote (mesma lógica do antigo ZeevDiagnosticCard).
 * Mantida intacta — só migrada pra dentro do ZeevAssistant pra alimentar a lista única.
 */
function useDiagnosticCounts(paymentId?: string | null, companyId?: string | null): {
  counts: DiagCounts | null;
  loading: boolean;
} {
  const [counts, setCounts] = useState<DiagCounts | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const h = () => setNonce((n) => n + 1);
    window.addEventListener("zeev:applied", h);
    return () => window.removeEventListener("zeev:applied", h);
  }, []);

  useEffect(() => {
    if (!paymentId) {
      setCounts(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: pay } = await supabase
        .from("payments")
        .select("cost_center_code")
        .eq("id", paymentId)
        .maybeSingle();
      const loteCc = (pay as { cost_center_code?: string | null } | null)?.cost_center_code ?? null;
      const loteHasCc = !!loteCc && String(loteCc).trim() !== "";

      let query = supabase
        .from("payment_items")
        .select(
          "id, ai_status, gross_amount, manual_intervention_reason_id, ai_findings, company_id, sector, cost_center_code, is_pool_item",
        )
        .eq("payment_id", paymentId)
        .limit(20000);
      if (companyId) query = query.eq("company_id", companyId);
      const { data, error } = await query;
      if (cancelled) return;
      if (error || !data) {
        setCounts(null);
        setLoading(false);
        return;
      }
      const c: DiagCounts = {
        total: 0,
        sem_setor: 0,
        sem_cc: 0,
        sem_empresa: 0,
        sem_regra: 0,
        divergentes: 0,
        zerados: 0,
      };
      for (const it of data as Array<Record<string, unknown>>) {
        c.total++;
        const gross = Number(it.gross_amount ?? 0);
        if (!gross) c.zerados++;
        const status = it.ai_status as string | null;
        if ((status === "reprovado" || status === "alerta") && !it.manual_intervention_reason_id) {
          c.divergentes++;
        }
        const findings = it.ai_findings as { needs_human_review?: boolean } | null;
        if (findings?.needs_human_review) c.sem_regra++;
        if (!it.sector || it.sector === "") c.sem_setor++;
        if (!loteHasCc && (!it.cost_center_code || it.cost_center_code === "")) c.sem_cc++;
        if (!it.company_id && !it.is_pool_item) c.sem_empresa++;
      }
      setCounts(c);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId, companyId, nonce]);

  return { counts, loading };
}

/**
 * Deriva insights do pré-flight. Cada bucket sabe atuar via evento `zeev:apply-filter`
 * (mesmo mecanismo de antes) ou via chatPrompt encaminhado ao executor.
 */
function diagnosticInsights(
  counts: DiagCounts,
  scopeLabel: string,
): Array<ZeevInsight & { topic: DiagBucket["topic"] }> {
  const out: Array<ZeevInsight & { topic: DiagBucket["topic"] }> = [];
  const applyFilter = (f: "divergentes" | "sem_regra" | "reprovados" | "zerados") => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zeev:apply-filter", { detail: { filter: f } }));
    }
  };
  if (counts.sem_setor > 0) {
    out.push({
      id: "diag-sem_setor",
      topic: "sem_setor",
      priority: "media",
      icon: MapPin,
      title: `${counts.sem_setor} itens sem setor`,
      message: `Preciso do setor pra classificar. Posso resolver em lote agora.`,
      chatPrompt: `Define o setor nos ${counts.sem_setor} itens sem setor ${scopeLabel}`,
      chatActionLabel: "Resolver em lote",
    });
  }
  if (counts.sem_cc > 0) {
    out.push({
      id: "diag-sem_cc",
      topic: "sem_cc",
      priority: "media",
      icon: Building2,
      title: `${counts.sem_cc} itens sem centro de custos`,
      message: `Sem CC o lançamento no financeiro fica travado.`,
      chatPrompt: `Define o centro de custos nos ${counts.sem_cc} itens sem CC ${scopeLabel}`,
      chatActionLabel: "Resolver em lote",
    });
  }
  if (counts.sem_empresa > 0) {
    out.push({
      id: "diag-sem_empresa",
      topic: "sem_empresa",
      priority: "alta",
      icon: Building2,
      title: `${counts.sem_empresa} médicos sem PJ vinculada`,
      message: `Sem PJ o repasse não é aplicado. Precisa vincular antes de seguir.`,
      chatPrompt: `Vincula os médicos sem PJ ${scopeLabel}`,
      chatActionLabel: "Resolver em lote",
    });
  }
  if (counts.sem_regra > 0) {
    out.push({
      id: "diag-sem_regra",
      topic: "sem_regra",
      priority: "alta",
      icon: ShieldQuestion,
      title: `${counts.sem_regra} itens sem regra cadastrada`,
      message: `Nenhum repasse foi calculado — vale revisar cadastro ou tratar manualmente.`,
      actionLabel: "Ver no grid",
      onAction: () => applyFilter("sem_regra"),
    });
  }
  if (counts.divergentes > 0) {
    out.push({
      id: "diag-divergentes",
      topic: "divergentes",
      priority: "media",
      icon: AlertTriangle,
      title: `${counts.divergentes} divergências sem tratativa`,
      message: `Itens reprovado/alerta que ainda não receberam decisão do analista.`,
      actionLabel: "Ver no grid",
      onAction: () => applyFilter("divergentes"),
    });
  }
  if (counts.zerados > 0) {
    out.push({
      id: "diag-zerados",
      topic: "zerados",
      priority: "baixa",
      icon: AlertTriangle,
      title: `${counts.zerados} itens com valor zerado`,
      message: `Sem valor bruto declarado. Confirma se são cancelamentos ou dados faltantes.`,
      actionLabel: "Ver no grid",
      onAction: () => applyFilter("zerados"),
    });
  }
  return out;
}

/** Mapeia um insight (auto ou extra) para um tópico do pré-flight, se aplicável. */
function insightTopic(ins: ZeevInsight): DiagBucket["topic"] | null {
  if (ins.id === "muitos-divergentes") return "divergentes";
  if (ins.id === "sem-regra") return "sem_regra";
  return null;
}

export function ZeevAssistant({
  pageLabel,
  summary: _summary,
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
  const [mode, setMode] = useState<"insights" | "chat">("insights");
  // Escopo da dispensa: por lote+empresa (ou "global" quando fora de contexto).
  // Isso evita que dispensar "muitos-divergentes" numa empresa oculte a mesma
  // sugestão em TODAS as outras empresas/lotes até fechar a aba — que era o
  // sintoma de "Zeev parou de sugerir acates em lote".
  const dismissScopeKey = useMemo(() => {
    const p = bulkContext?.paymentId ?? "global";
    const c = bulkContext?.companyId ?? bulkContext?.companyGroupId ?? "all";
    return `${HIDDEN_KEY}::${p}::${c}`;
  }, [bulkContext?.paymentId, bulkContext?.companyId, bulkContext?.companyGroupId]);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  // Recarrega o conjunto dispensado ao trocar de escopo (lote/empresa).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(dismissScopeKey);
      setDismissed(raw ? new Set(JSON.parse(raw) as string[]) : new Set());
    } catch {
      setDismissed(new Set());
    }
  }, [dismissScopeKey]);
  const [bulkOpen, setBulkOpen] = useState<ZeevInsight | null>(null);
  const [suggestOpen, setSuggestOpen] = useState<ZeevInsight | null>(null);
  const [chatInitialPrompt, setChatInitialPrompt] = useState<{ text: string; nonce: number } | null>(null);
  const stagingMode = !!stagingContext && !bulkContext?.paymentId;

  const { counts: diagCounts } = useDiagnosticCounts(
    bulkContext?.paymentId ?? null,
    bulkContext?.companyId ?? null,
  );

  // Insights automáticos + extras (com ações ricas de bulk/sugerir regra)
  const richInsights = useMemo<ZeevInsight[]>(() => {
    const auto = items ? buildItemInsights(items, onApplyFilter) : [];
    const merged: ZeevInsight[] = [...(extraInsights ?? []), ...auto];
    if (!smartActionsEnabled) {
      return merged.map((i) => ({ ...i, bulk: undefined, suggestRule: undefined }));
    }
    return merged;
  }, [items, extraInsights, onApplyFilter, smartActionsEnabled]);

  // Lista unificada: pre-flight (só tópicos não cobertos por insight rico) + ricos
  const unified = useMemo<ZeevInsight[]>(() => {
    const richTopics = new Set(richInsights.map(insightTopic).filter(Boolean));
    const scopeLabel = bulkContext?.companyId
      ? bulkContext?.companyName ?? "desta empresa"
      : "deste lote";
    const diag = diagCounts ? diagnosticInsights(diagCounts, scopeLabel) : [];
    const filteredDiag = diag.filter((d) => !richTopics.has(d.topic));
    const all = [...richInsights, ...filteredDiag];
    return all.sort(
      (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority],
    );
  }, [richInsights, diagCounts, bulkContext?.companyId, bulkContext?.companyName]);

  const visible = unified.filter((i) => !dismissed.has(i.id));
  const highPriority = visible.filter((i) => i.priority === "alta").length;
  const hasInsights = visible.length > 0;
  // Quantos insights foram dispensados NESTE escopo mas ainda existem na lista
  // — usado para expor um "Restaurar sugestões" quando o analista quiser
  // trazê-los de volta sem precisar fechar a aba.
  const dismissedVisibleCount = unified.filter((i) => dismissed.has(i.id)).length;

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try {
      sessionStorage.setItem(dismissScopeKey, JSON.stringify([...next]));
    } catch {
      /* noop */
    }
  };

  const restoreDismissed = () => {
    setDismissed(new Set());
    try {
      sessionStorage.removeItem(dismissScopeKey);
    } catch {
      /* noop */
    }
  };


  const openChatWith = (text?: string) => {
    if (text) setChatInitialPrompt({ text, nonce: Date.now() });
    setMode("chat");
  };

  // Reseta modo ao fechar
  useEffect(() => {
    if (!open) setMode("insights");
  }, [open]);

  const sideClass = side === "bottom-right" ? "bottom-6 right-24" : "bottom-6 left-6";
  const headerTitle = bulkContext?.companyId
    ? "Zeev · Análise da empresa"
    : bulkContext?.paymentId
      ? "Zeev · Análise do lote"
      : "Zeev · Apoio analítico";
  const headerSubtitle =
    bulkContext?.companyName ?? (bulkContext?.paymentId ? "Lote em análise" : pageLabel);
  const headerPill = diagCounts
    ? `${visible.length} pendentes de ${diagCounts.total}`
    : visible.length > 0
      ? `${visible.length} pendentes`
      : null;

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
          className="w-[420px] max-w-[calc(100vw-2rem)] p-0 overflow-hidden rounded-2xl border-[hsl(var(--primary))]/20 shadow-2xl"
        >
          {/* Cabeçalho */}
          <div className="relative bg-gradient-to-br from-[hsl(var(--primary))] via-[hsl(var(--primary))] to-[hsl(var(--primary-dark))] px-4 py-3 pr-12 text-[hsl(var(--primary-foreground))]">
            <div className="flex items-center gap-3">
              {mode === "chat" ? (
                <button
                  type="button"
                  onClick={() => setMode("insights")}
                  aria-label="Voltar para insights"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20 hover:bg-white/25 transition"
                >
                  <ArrowLeft className="h-4 w-4 text-white" />
                </button>
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                  <ZeevIcon className="h-5 w-5 text-white" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium leading-tight">
                  {mode === "chat" ? "Zeev · Conversa" : headerTitle}
                </div>
                <div
                  className="text-[11px] opacity-90 leading-snug mt-0.5 truncate"
                  title={headerSubtitle}
                >
                  {headerSubtitle}
                </div>
              </div>
              {mode === "insights" && headerPill && (
                <span className="shrink-0 bg-white/15 rounded-full text-[10px] px-2 py-0.5 tabular-nums whitespace-nowrap">
                  {headerPill}
                </span>
              )}
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

          {/* === MODO: INSIGHTS === */}
          {mode === "insights" && (
            <>
              {/* Gaps retroativos (fora do contexto de lote) — mantido como bloco compacto */}
              {!bulkContext?.paymentId && !stagingMode && (
                <div className="px-3 pt-3">
                  <ZeevRetroactiveGapsCard onActed={() => setOpen(false)} />
                </div>
              )}

              {/* Lista unificada de insights */}
              <div className="max-h-[52vh] overflow-y-auto p-3 space-y-2">
                {visible.length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-6 px-2 leading-relaxed">
                    Nenhuma pendência aqui. Estou de olho — se algo aparecer, eu aviso.
                  </div>
                )}
                {visible.map((ins) => {
                  const Icon = ins.icon;
                  const canBulk = ins.bulk && bulkContext && ins.bulk.itemIds.length > 0;
                  const canSuggest = ins.suggestRule && bulkContext;
                  const canChat = !!ins.chatPrompt;
                  const canFilter = !!ins.onAction && !!ins.actionLabel;
                  return (
                    <div
                      key={ins.id}
                      className="border border-border rounded-lg bg-card p-3 space-y-2 transition-shadow hover:shadow-sm"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 rounded-full shrink-0",
                            PRIORITY_DOT[ins.priority],
                          )}
                          aria-hidden
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-medium leading-snug text-foreground break-words">
                              {Icon && <Icon className="inline h-3.5 w-3.5 mr-1 -mt-0.5 text-muted-foreground" />}
                              {ins.title}
                            </p>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0 mt-0.5">
                              {PRIORITY_LABEL[ins.priority]}
                            </span>
                          </div>
                          <p className="text-[12px] text-muted-foreground leading-relaxed mt-1 break-words">
                            {ins.message}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Ação primária: bulk > suggestRule > chat > filter */}
                        {canBulk ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setBulkOpen(ins);
                              setOpen(false);
                            }}
                            className="h-7 text-[11px] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
                          >
                            <Users className="h-3 w-3 mr-1" />
                            Tratar {ins.bulk!.itemIds.length} em lote
                          </Button>
                        ) : canSuggest ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSuggestOpen(ins);
                              setOpen(false);
                            }}
                            className="h-7 text-[11px] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
                          >
                            <Lightbulb className="h-3 w-3 mr-1" />
                            Sugerir regra
                          </Button>
                        ) : canChat ? (
                          <Button
                            size="sm"
                            onClick={() => openChatWith(ins.chatPrompt!)}
                            className="h-7 text-[11px] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
                          >
                            <ZeevIcon variant="mark" className="h-3 w-3 mr-1" />
                            {ins.chatActionLabel ?? "Resolver com o Zeev"}
                          </Button>
                        ) : canFilter ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              ins.onAction?.();
                              setOpen(false);
                            }}
                            className="h-7 text-[11px] bg-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-dark))]"
                          >
                            {ins.actionLabel}
                          </Button>
                        ) : null}

                        {/* Ação secundária (Ver no grid) — só quando a primária não é o próprio filtro */}
                        {(canBulk || canSuggest || canChat) && canFilter && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              ins.onAction?.();
                              setOpen(false);
                            }}
                            className="h-7 text-[11px]"
                          >
                            Ver no grid
                          </Button>
                        )}

                        <button
                          type="button"
                          onClick={() => dismiss(ins.id)}
                          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Dispensar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Rodapé: um único ponto de entrada de conversa */}
              <div className="border-t border-border/60 px-3 py-2.5 bg-muted/20 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openChatWith()}
                  className="h-8 text-[12px] gap-1.5"
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Conversar com o Zeev
                </Button>
              </div>

              <div className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground italic bg-muted/40">
                Zeev observa padrões — nada é alterado sem você confirmar.
              </div>
            </>
          )}

          {/* === MODO: CONVERSAR === */}
          {mode === "chat" && (
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
              expected_amount: it.expected_amount,
              gross_amount: it.gross_amount,
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





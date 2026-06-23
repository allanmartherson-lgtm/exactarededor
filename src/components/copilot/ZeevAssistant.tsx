import { useMemo, useState, useEffect } from "react";
import { Sparkles, X, ChevronRight, AlertTriangle, GitBranch, ShieldQuestion, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Zeev — assistente flutuante (estilo Clippy) que aparece na tela de análise
 * de pagamento e oferece sugestões proativas com base nos itens carregados.
 *
 * Não altera dados sozinho — só observa, explica e oferece atalhos para o
 * analista agir (filtrar, abrir tratativa manual, escalar regra ausente).
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

type Insight = {
  id: string;
  priority: "alta" | "media" | "baixa";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

interface Props {
  items: ZeevItem[];
  /** callback opcional que recebe um filtro sugerido (ex.: "divergentes"). */
  onApplyFilter?: (filter: "divergentes" | "sem_regra" | "reprovados") => void;
  /** scroll/highlight de um item específico. */
  onFocusItem?: (itemId: string) => void;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toString().trim().toLowerCase().replace(/\s+/g, " ");

function buildInsights(items: ZeevItem[], onApplyFilter?: Props["onApplyFilter"]): Insight[] {
  const out: Insight[] = [];
  const total = items.length;
  if (total === 0) return out;

  // 1) Muitos itens divergentes (reprovado/alerta sem tratativa manual)
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
      title: `Notei ${divergentes.length} itens divergentes`,
      message:
        `${Math.round(pctDiv * 100)}% dos itens estão como reprovado/alerta sem tratativa manual. ` +
        `Quer filtrar para revisar e aplicar justificativas?`,
      actionLabel: "Filtrar divergentes",
      onAction: onApplyFilter ? () => onApplyFilter("divergentes") : undefined,
    });
  }

  // 2) Mesmo médico/TUSS repetido reprovado (padrão = aplicar mesma justificativa)
  const groupCounts = new Map<string, { count: number; sampleId: string; doctor: string; tuss: string }>();
  for (const it of items) {
    if (it.ai_status !== "reprovado") continue;
    if (it.manual_intervention_reason_id) continue;
    const k = `${norm(it.doctor_name)}|${norm(it.procedure_code)}`;
    if (!k.includes("|") || k === "|") continue;
    const prev = groupCounts.get(k);
    if (prev) prev.count += 1;
    else
      groupCounts.set(k, {
        count: 1,
        sampleId: it.id,
        doctor: it.doctor_name ?? "—",
        tuss: it.procedure_code ?? "—",
      });
  }
  const repeated = [...groupCounts.values()]
    .filter((g) => g.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  for (const g of repeated) {
    out.push({
      id: `padrao-${g.doctor}-${g.tuss}`,
      priority: g.count >= 5 ? "alta" : "media",
      icon: GitBranch,
      title: `Padrão repetido (${g.count}× reprovado)`,
      message:
        `${g.doctor} · TUSS ${g.tuss} apareceu ${g.count}× reprovado. ` +
        `Provavelmente cabe a mesma justificativa para todos.`,
    });
  }

  // 3) Itens sem regra
  const semRegra = items.filter(
    (i) =>
      i.applied_calc_method === "sem_regra" ||
      (!i.applied_rule_id && !i.applied_calc_method),
  );
  if (semRegra.length >= 3) {
    out.push({
      id: "sem-regra",
      priority: semRegra.length >= 10 ? "alta" : "media",
      icon: ShieldQuestion,
      title: `${semRegra.length} itens sem regra cadastrada`,
      message:
        `Esses itens não tiveram repasse calculado. Vale revisar o cadastro de regras ` +
        `ou marcar manualmente até a regra entrar.`,
      actionLabel: onApplyFilter ? "Ver sem regra" : undefined,
      onAction: onApplyFilter ? () => onApplyFilter("sem_regra") : undefined,
    });
  }

  // 4) Inconsistência: tratativa manual mas status ≠ aprovado
  const inconsistentes = items.filter(
    (i) => i.manual_intervention_reason_id && i.ai_status !== "aprovado",
  );
  if (inconsistentes.length > 0) {
    out.push({
      id: "inconsistencias",
      priority: "alta",
      icon: AlertTriangle,
      title: `${inconsistentes.length} inconsistência(s) de status`,
      message:
        `Itens com tratativa manual deveriam estar APROVADOS. ` +
        `Estou avisando — a correção automática roda ao recarregar a tela.`,
    });
  }

  return out;
}

const PRIORITY_STYLE: Record<Insight["priority"], string> = {
  alta: "border-rose-300 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30",
  media: "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30",
  baixa: "border-sky-300 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/30",
};

const HIDDEN_KEY = "zeev-dismissed-insights";

export function ZeevAssistant({ items, onApplyFilter, onFocusItem }: Props) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem(HIDDEN_KEY);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const [pulse, setPulse] = useState(true);

  const insights = useMemo(() => buildInsights(items, onApplyFilter), [items, onApplyFilter]);
  const visible = insights.filter((i) => !dismissed.has(i.id));
  const highPriority = visible.filter((i) => i.priority === "alta").length;

  // pulse animation 1× quando aparece nova insight
  useEffect(() => {
    if (visible.length > 0) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 6000);
      return () => clearTimeout(t);
    }
  }, [visible.length]);

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

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Zeev — assistente de análise"
            className={cn(
              "group relative flex items-center gap-2 rounded-full pl-2 pr-3 py-2 shadow-lg",
              "bg-gradient-to-br from-violet-600 via-fuchsia-600 to-purple-700 text-white",
              "hover:scale-105 transition-transform",
              pulse && "animate-pulse",
            )}
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-white/15 backdrop-blur">
              <Sparkles className="h-4 w-4" />
              <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold ring-2 ring-purple-700">
                {visible.length}
              </span>
            </div>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-[10px] uppercase tracking-wider opacity-80">Zeev</span>
              <span className="text-xs font-medium">
                {highPriority > 0 ? `${highPriority} alerta(s) urgente(s)` : "Tenho sugestões"}
              </span>
            </div>
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          className="w-[380px] p-0 overflow-hidden border-purple-200 dark:border-purple-900"
        >
          <div className="bg-gradient-to-br from-violet-600 via-fuchsia-600 to-purple-700 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
                <Wand2 className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">Oi, sou o Zeev 👋</div>
                <div className="text-[11px] opacity-90">
                  Dei uma olhada nos itens e separei {visible.length} ponto(s) para você
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

          <div className="max-h-[60vh] overflow-y-auto p-3 space-y-2">
            {visible.map((ins) => {
              const Icon = ins.icon;
              return (
                <div
                  key={ins.id}
                  className={cn(
                    "rounded-lg border p-3 space-y-2 transition",
                    PRIORITY_STYLE[ins.priority],
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Icon className="h-4 w-4 mt-0.5 shrink-0 text-foreground/70" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium leading-tight">{ins.title}</p>
                        <Badge
                          variant="outline"
                          className="text-[9px] h-4 px-1 capitalize shrink-0"
                        >
                          {ins.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {ins.message}
                      </p>
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
            Zeev observa padrões nos itens carregados — nada é alterado sem você confirmar.
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

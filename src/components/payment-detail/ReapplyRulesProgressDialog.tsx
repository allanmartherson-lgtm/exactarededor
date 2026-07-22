import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  RefreshCcw,
  AlertTriangle,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  Circle,
} from "lucide-react";
import type { PaymentItemRow } from "@/hooks/usePaymentDetailData";
import { cn } from "@/lib/utils";

export type ReapplyPhase = "iniciando" | "processando" | "concluido" | "erro";

export type ReapplyStep =
  | "ler_regras"
  | "rodar_motor"
  | "ajustes_finais"
  | "persistir_itens"
  | "carregar_ui";

const STEP_ORDER: ReapplyStep[] = [
  "ler_regras",
  "rodar_motor",
  "ajustes_finais",
  "persistir_itens",
  "carregar_ui",
];

const STEP_LABELS: Record<ReapplyStep, { title: string; hint: string }> = {
  ler_regras: {
    title: "Lendo regras e cadastros",
    hint: "Snapshot do estado atual e carregamento das regras vigentes",
  },
  rodar_motor: {
    title: "Rodando motor de cálculo",
    hint: "Recalculando valor esperado e regra vencedora de cada item",
  },
  ajustes_finais: {
    title: "Aplicando ajustes finais",
    hint: "Deduções, glosas, garantia mínima e reconciliação retroativa",
  },
  persistir_itens: {
    title: "Persistindo itens",
    hint: "Gravando novo status, regra aplicada e cálculo no banco",
  },
  carregar_ui: {
    title: "Atualizando a tela",
    hint: "Relendo os itens da empresa para refletir o resultado",
  },
};

export type ReapplySnapshot = Record<
  string,
  {
    ai_status: string | null;
    applied_rule_id: string | null;
    expected_amount: number | null;
  }
>;

export type ReapplyDiff = {
  totalItems: number;
  reanalyzedItems: number;
  becameApproved: number; // antes !aprovado → aprovado
  stayedReproved: number; // antes reprovado → continua reprovado
  newlyReproved: number;  // antes aprovado/pendente → reprovado
  ruleChanged: number;    // applied_rule_id mudou
  unchanged: number;      // nada mudou
  approvedTotal: number;  // total final aprovados
  reprovedTotal: number;  // total final reprovados
  pendingTotal: number;   // total final pendentes/outros
};

export function takeSnapshot(items: PaymentItemRow[]): ReapplySnapshot {
  const snap: ReapplySnapshot = {};
  for (const it of items) {
    snap[it.id] = {
      ai_status: (it as any).ai_status ?? null,
      applied_rule_id: (it as any).applied_rule_id ?? null,
      expected_amount: (it as any).expected_amount ?? null,
    };
  }
  return snap;
}

export function diffSnapshots(
  before: ReapplySnapshot,
  after: PaymentItemRow[],
): ReapplyDiff {
  let becameApproved = 0;
  let stayedReproved = 0;
  let newlyReproved = 0;
  let ruleChanged = 0;
  let unchanged = 0;
  let approvedTotal = 0;
  let reprovedTotal = 0;
  let pendingTotal = 0;

  for (const it of after) {
    const cur = (it as any).ai_status ?? null;
    const prev = before[it.id]?.ai_status ?? null;
    const prevRule = before[it.id]?.applied_rule_id ?? null;
    const curRule = (it as any).applied_rule_id ?? null;

    if (cur === "aprovado") approvedTotal++;
    else if (cur === "reprovado") reprovedTotal++;
    else pendingTotal++;

    const wasReproved = prev === "reprovado";
    const wasApproved = prev === "aprovado";
    const isReproved = cur === "reprovado";
    const isApproved = cur === "aprovado";

    if (!wasApproved && isApproved) becameApproved++;
    else if (wasReproved && isReproved) stayedReproved++;
    else if (!wasReproved && isReproved) newlyReproved++;

    const ruleDelta = prevRule !== curRule;
    if (ruleDelta && cur === prev) ruleChanged++;
    if (cur === prev && !ruleDelta) unchanged++;
  }

  return {
    totalItems: after.length,
    reanalyzedItems: after.filter((it) => {
      const prev = before[it.id];
      if (!prev) return true;
      return (
        prev.ai_status !== ((it as any).ai_status ?? null) ||
        prev.applied_rule_id !== ((it as any).applied_rule_id ?? null) ||
        Number(prev.expected_amount ?? 0) !== Number((it as any).expected_amount ?? 0)
      );
    }).length,
    becameApproved,
    stayedReproved,
    newlyReproved,
    ruleChanged,
    unchanged,
    approvedTotal,
    reprovedTotal,
    pendingTotal,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phase: ReapplyPhase;
  /** etapa atual do pipeline (somente quando running) */
  step?: ReapplyStep;
  /** segundos decorridos (para feedback visual) */
  elapsedSec: number;
  /** total de itens da empresa, mostrado durante o processamento */
  totalItems: number;
  /** mensagem de erro, quando phase === "erro" */
  errorMessage?: string | null;
  /** diff calculado quando phase === "concluido" */
  diff?: ReapplyDiff | null;
  /** label opcional, ex. nome da empresa */
  companyLabel?: string;
  /** Modo do lote — muda vocabulário: confecção fala em "cálculo" / análise em "auditoria" */
  mode?: "analise" | "confeccao";
}

/**
 * Estima o tempo total da reaplicação em segundos.
 * Baseado em medição empírica: ~0.35s por item no motor + overhead fixo
 * de leitura de regras (3s), persistência (~0.05s/item) e UI (1s).
 * Piso de 8s, teto de 180s.
 */
function estimateTotalSec(totalItems: number): number {
  const fixed = 3 + 1; // ler regras + UI
  const perItem = 0.4; // motor + persistência
  const raw = fixed + totalItems * perItem;
  return Math.max(8, Math.min(180, Math.round(raw)));
}

/**
 * Diálogo de progresso e resumo do "Reaplicar regras".
 *
 * - Mostra status em tempo real: iniciando → processando → concluído/erro.
 * - Durante a execução exibe checklist de 4 etapas + ETA, reduzindo a
 *   sensação de lentidão (motor não emite progresso real).
 * - Ao final, exibe contagem do que melhorou (passou a aprovado), do que
 *   continuou reprovado, do que piorou (novo reprovado), regras alteradas
 *   sem mudança de status, e totais finais.
 * - Não fecha sozinho — o usuário fecha após ler o resumo.
 */
export function ReapplyRulesProgressDialog({
  open,
  onOpenChange,
  phase,
  step,
  elapsedSec,
  totalItems,
  errorMessage,
  diff,
  companyLabel,
  mode = "analise",
}: Props) {
  const running = phase === "iniciando" || phase === "processando";
  const isConfeccao = mode === "confeccao";

  const estimatedTotal = useMemo(() => estimateTotalSec(totalItems), [totalItems]);
  const etaSec = Math.max(0, estimatedTotal - elapsedSec);

  // Progresso baseado em etapa concluída (25% por etapa) com fração linear
  // dentro da etapa atual em função do ETA. Cap em 95% até "concluido".
  const progressValue = useMemo(() => {
    if (phase === "concluido") return 100;
    if (phase === "erro") return 100;
    const currentIdx = step ? STEP_ORDER.indexOf(step) : 0;
    const stepBase = (currentIdx / STEP_ORDER.length) * 100;
    const intraStep = Math.min(1, elapsedSec / Math.max(1, estimatedTotal)) * (100 / STEP_ORDER.length);
    return Math.max(5, Math.min(95, Math.round(stepBase + intraStep)));
  }, [phase, step, elapsedSec, estimatedTotal]);


  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Bloqueia fechar enquanto está rodando.
        if (running) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          {/* Timeout do polling não é falha de cálculo — o motor segue em
              background. Detecta pela mensagem para trocar ícone/título por
              versão informativa (evita alarme desnecessário no analista). */}
          {(() => {
            const isTimeout =
              phase === "erro" &&
              typeof errorMessage === "string" &&
              errorMessage.includes("processando em segundo plano");
            return (
              <>
                <DialogTitle className="flex items-center gap-2">
                  {phase === "concluido" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  ) : phase === "erro" ? (
                    isTimeout ? (
                      <Loader2 className="h-5 w-5 text-primary animate-spin" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    )
                  ) : (
                    <RefreshCcw className="h-5 w-5 text-primary animate-spin" />
                  )}
                  {phase === "concluido"
                    ? (isConfeccao ? "Cálculo do repasse concluído" : "Reaplicação concluída")
                    : phase === "erro"
                    ? (isTimeout
                        ? "Motor ainda processando"
                        : (isConfeccao ? "Falha ao calcular o repasse" : "Falha ao reaplicar regras"))
                    : (isConfeccao ? "Calculando repasse…" : "Reaplicando regras…")}
                </DialogTitle>
                <DialogDescription>
                  {companyLabel ? <span className="font-medium">{companyLabel}</span> : null}
                  {companyLabel ? " · " : null}
                  {phase === "iniciando" && "Preparando o motor de cálculo…"}
                  {phase === "processando" &&
                    (isConfeccao
                      ? `Calculando o repasse de ${totalItems} ${totalItems === 1 ? "item" : "itens"} com as regras atuais. Tempo decorrido: ${elapsedSec}s.`
                      : `Reanalisando ${totalItems} ${totalItems === 1 ? "item" : "itens"} com as regras atuais. Tempo decorrido: ${elapsedSec}s.`)}
                  {phase === "concluido" &&
                    (isConfeccao
                      ? "O motor terminou de aplicar as regras. Veja abaixo como ficou o repasse calculado."
                      : "O motor terminou. Veja abaixo o que mudou em relação ao estado anterior.")}
                  {phase === "erro" && (errorMessage ?? "Não foi possível concluir a operação.")}
                </DialogDescription>
              </>
            );
          })()}
        </DialogHeader>


        {running && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Progress value={progressValue} />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>Decorrido: {elapsedSec}s</span>
                <span>
                  {etaSec > 0
                    ? `Estimativa restante: ~${etaSec}s`
                    : "Finalizando…"}
                  {" · "}
                  total estimado ~{estimatedTotal}s
                </span>
              </div>
            </div>

            <ol className="space-y-1.5">
              {STEP_ORDER.map((s, idx) => {
                const currentIdx = step ? STEP_ORDER.indexOf(step) : 0;
                const state: "done" | "current" | "pending" =
                  idx < currentIdx ? "done" : idx === currentIdx ? "current" : "pending";
                const meta = STEP_LABELS[s];
                return (
                  <li
                    key={s}
                    className={cn(
                      "flex items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors",
                      state === "done" && "border-emerald-500/30 bg-emerald-500/5",
                      state === "current" && "border-primary/40 bg-primary/5",
                      state === "pending" && "border-border bg-muted/20 opacity-70",
                    )}
                  >
                    <span className="mt-0.5 shrink-0">
                      {state === "done" ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      ) : state === "current" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={cn(
                        "font-medium leading-tight",
                        state === "pending" && "text-muted-foreground",
                      )}>
                        {meta.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-snug">
                        {meta.hint}
                      </div>
                    </div>
                    <span className="text-[10px] text-muted-foreground tabular-nums pt-0.5">
                      {idx + 1}/{STEP_ORDER.length}
                    </span>
                  </li>
                );
              })}
            </ol>

            <p className="text-[11px] text-muted-foreground">
              {totalItems} {totalItems === 1 ? "item" : "itens"} nesta empresa · novos códigos em tabelas
              de exceção (sem acordo / exclusão) são lidos a cada execução, sem cache.
            </p>
          </div>
        )}


        {phase === "concluido" && diff && !isConfeccao && (
          <div className="space-y-4 py-2">
            {/* Cards de transições (modo análise) */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                tone="success"
                icon={<TrendingUp className="h-4 w-4" />}
                label="Passaram a aprovado"
                value={diff.becameApproved}
                hint="Estavam reprovados/pendentes e agora estão aprovados"
              />
              <StatCard
                tone="danger"
                icon={<RefreshCcw className="h-4 w-4" />}
                label="Continuam reprovados"
                value={diff.stayedReproved}
                hint="Estavam reprovados antes e seguem reprovados"
              />
              <StatCard
                tone="warning"
                icon={<TrendingDown className="h-4 w-4" />}
                label="Novos reprovados"
                value={diff.newlyReproved}
                hint="Estavam aprovados/pendentes e agora ficaram reprovados"
              />
              <StatCard
                tone="info"
                icon={<RefreshCcw className="h-4 w-4" />}
                label="Regra trocou (mesmo status)"
                value={diff.ruleChanged}
                hint="Outra regra passou a vencer, mas o status final é o mesmo"
              />
            </div>

            {/* Totais finais */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Estado atual da empresa
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                  {diff.approvedTotal} aprovados
                </Badge>
                <Badge variant="outline" className="border-destructive/40 text-destructive">
                  {diff.reprovedTotal} reprovados
                </Badge>
                <Badge variant="outline" className="text-muted-foreground">
                  {diff.pendingTotal} pendentes/outros
                </Badge>
                <span className="text-xs text-muted-foreground ml-auto">
                  {diff.reanalyzedItems} de {diff.totalItems} itens recalculados
                </span>
              </div>
            </div>

            {diff.stayedReproved > 0 && (
              <div className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Minus className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  Os <strong>{diff.stayedReproved}</strong> itens que continuam reprovados aparecem com o badge
                  vermelho na tabela — verifique se falta cadastrar regra, se o convênio/setor está bloqueado
                  pela regra vencedora, ou se há divergência real de valor.
                </span>
              </div>
            )}
          </div>
        )}

        {phase === "concluido" && diff && isConfeccao && (
          <div className="space-y-4 py-2">
            {/* Cards específicos do modo confecção — não há "reprovado" aqui,
                o que importa é quantos itens ganharam valor calculado pela regra
                vs. quantos ficaram sem regra cadastrada. */}
            <div className="grid grid-cols-2 gap-2">
              <StatCard
                tone="success"
                icon={<TrendingUp className="h-4 w-4" />}
                label="Repasse calculado"
                value={diff.approvedTotal}
                hint="Itens que receberam valor de repasse a partir de uma regra vencedora"
              />
              <StatCard
                tone="warning"
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Sem regra cadastrada"
                value={diff.reprovedTotal}
                hint="Itens sem regra aplicável — cadastre uma regra ou ajuste o escopo para incluí-los"
              />
              <StatCard
                tone="info"
                icon={<RefreshCcw className="h-4 w-4" />}
                label="Itens recalculados"
                value={diff.reanalyzedItems}
                hint="Itens cujo valor calculado, regra vencedora ou status mudaram nesta execução"
              />
              <StatCard
                tone="info"
                icon={<RefreshCcw className="h-4 w-4" />}
                label="Regra trocou"
                value={diff.ruleChanged}
                hint="Outra regra passou a vencer para o item após a sua última edição"
              />
            </div>

            {/* Totais finais — vocabulário de confecção */}
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">
                Estado do cálculo da empresa
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
                  {diff.approvedTotal} com regra
                </Badge>
                <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                  {diff.reprovedTotal} sem regra
                </Badge>
                {diff.pendingTotal > 0 && (
                  <Badge variant="outline" className="text-muted-foreground">
                    {diff.pendingTotal} pendentes
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {diff.totalItems} {diff.totalItems === 1 ? "item" : "itens"} no total
                </span>
              </div>
            </div>

            {diff.reprovedTotal > 0 && (
              <div className="text-xs text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  <strong>{diff.reprovedTotal}</strong> {diff.reprovedTotal === 1 ? "item ficou" : "itens ficaram"} sem regra
                  cadastrada. Cadastre/edite a regra correspondente e clique em <strong>Recalcular repasse</strong> novamente —
                  o motor lê o estado atual do banco a cada execução manual.
                </span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant={phase === "concluido" ? "default" : "outline"}
            onClick={() => onOpenChange(false)}
            disabled={running}
          >
            {running ? "Aguarde…" : "Fechar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  tone,
  icon,
  label,
  value,
  hint,
}: {
  tone: "success" | "danger" | "warning" | "info";
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
      : tone === "danger"
      ? "border-destructive/40 bg-destructive/5 text-destructive"
      : tone === "warning"
      ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300"
      : "border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-300";
  return (
    <div className={cn("rounded-md border p-3", toneClass)}>
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] opacity-80 mt-0.5 leading-snug">{hint}</div>
    </div>
  );
}

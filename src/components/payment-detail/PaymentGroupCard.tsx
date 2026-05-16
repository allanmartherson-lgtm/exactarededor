import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  ChevronDown,
  ChevronRight,
  Receipt,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import {
  formatCurrency,
  TONE_CLASSES,
  type ItemAiStatus,
  type PaymentStatus,
} from "@/lib/status";
import {
  ANALYST_DONE_STATUSES,
  effectiveItemAiStatus,
} from "@/lib/paymentFlow";
import type {
  GroupRow,
  InvoiceRow,
  ObservationRow,
  PaymentItemRow as PaymentItemRowData,
} from "@/hooks/usePaymentDetailData";
import { scoreAttendance, classifyRisk, scoreItem, calculateFinancialRisk } from "@/lib/riskScore";
import { RiskBadge } from "./RiskBadge";
import { SafeCard } from "@/components/ui/SafeCard";
import { cn } from "@/lib/utils";

export type PaymentGroupCardProps = {
  g: GroupRow;
  /**
   * TODOS os itens da empresa (sem aplicar filtros/busca do lote).
   * O resumo (totais, badges, alertas, risco, complementos) deve sempre
   * refletir o mesmo conjunto exibido na página dedicada — caso contrário
   * o lote e a dedicada divergem ao aplicar filtros.
   */
  groupItems: PaymentItemRowData[];
  /** Indica se a busca atual já casou com o nome do grupo (afeta a expansão forçada). */
  searchActive: boolean;
  obs: ObservationRow[];
  invoices: InvoiceRow[];

  // Estado controlado pelo parent (mantido global pois a página inteira lê).
  isExpanded: boolean;
  onToggleExpanded: () => void;
  isAiOpen: boolean;
  onToggleAiOpen: () => void;
};

/**
 * Card-resumo executivo de uma empresa (grupo) dentro do pagamento.
 *
 * Mostra somente o panorama (totais, status, risco, parecer da IA, NF).
 * Toda interação detalhada (tabela, comentários, ações de fluxo, exceções
 * autorizadas, comparação de versões da IA) acontece na página dedicada
 * `/pagamentos/:id/empresa/:groupId`, que é a única fonte de trabalho.
 */
export const PaymentGroupCard = ({
  g,
  groupItems,
  searchActive,
  obs,
  invoices,
  isExpanded,
  onToggleExpanded,
  isAiOpen,
  onToggleAiOpen,
}: PaymentGroupCardProps) => {
  const { id: paymentId } = useParams<{ id: string }>();
  const gStatus = g.status as PaymentStatus;
  const analystDone = ANALYST_DONE_STATUSES.has(gStatus);
  const groupAlerts = groupItems
    .filter((it) => (it.ai_findings?.alerts ?? []).length > 0)
    .map((it) => ({ item: it, alerts: it.ai_findings!.alerts as string[] }));
  // Contagem de alertas assistenciais (regras de validação disparadas) na empresa.
  // Lê `validation_findings` gravado pelo motor em payment_items.
  const validationAlertCount = groupItems.reduce((count, it) => {
    const findings = (it as unknown as { validation_findings?: unknown }).validation_findings;
    return count + (Array.isArray(findings) ? findings.length : 0);
  }, 0);
  const gCounts = groupItems.reduce(
    (acc, it) => {
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
      const bucket: ItemAiStatus = eff === "seguido" ? "aprovado" : eff;
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    },
    { pendente: 0, aprovado: 0, alerta: 0, reprovado: 0, erro_duplicidade_pagamento: 0, erro_duplicidade_calculo: 0 } as Record<ItemAiStatus, number>,
  );

  // Conferência bruto x NF (por empresa) — apenas notas RECEBIDAS.
  const groupInvoices = invoices.filter((inv) => {
    if (inv.received_amount == null) return false;
    if (inv.company_id && g.company_id) return inv.company_id === g.company_id;
    return (inv.company_name ?? "").trim().toLowerCase() === g.company_name.trim().toLowerCase();
  });
  const nfReceivedTotal = groupInvoices.reduce(
    (acc, inv) => acc + Number(inv.received_amount ?? 0),
    0,
  );
  const nfDiff = groupInvoices.length > 0
    ? Number((nfReceivedTotal - Number(g.total_amount)).toFixed(2))
    : 0;
  const nfDivergent = groupInvoices.length > 0 && Math.abs(nfDiff) > 0;
  const groupExpandedEffective = searchActive ? true : isExpanded;

  // === Priorização por risco ===
  const attendanceMap = new Map<string, PaymentItemRowData[]>();
  for (const it of groupItems) {
    const att = (it.attendance_number ?? "").trim();
    if (!att) continue;
    const arr = attendanceMap.get(att) ?? [];
    arr.push(it);
    attendanceMap.set(att, arr);
  }
  const attendanceScores = new Map<string, ReturnType<typeof scoreAttendance>>();
  for (const [att, arr] of attendanceMap) {
    attendanceScores.set(att, scoreAttendance(arr));
  }
  const groupFinancialRisk = calculateFinancialRisk(groupItems);
  const groupMaxScore = groupFinancialRisk.score;
  const groupRisk = groupFinancialRisk.level;
  const groupMaxBreakdown = groupFinancialRisk;

  const dedicatedHref = paymentId ? `/pagamentos/${paymentId}/empresa/${g.id}` : "#";

  return (
    <SafeCard className="shadow-card p-0">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        aria-expanded={groupExpandedEffective}
      >
        <div className="flex items-center gap-2 min-w-0">
          {groupExpandedEffective ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-base font-semibold truncate flex-1">{g.company_name}</span>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            · {g.items_count} itens · {formatCurrency(g.total_amount)}
          </span>
          <div className="hidden md:flex items-center gap-1 ml-2">
            {gCounts.aprovado > 0 && (
              <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.success}`}>
                ✓ {gCounts.aprovado}
              </span>
            )}
            {gCounts.alerta > 0 && (
              <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.warning}`}>
                ⚠ {gCounts.alerta}
              </span>
            )}
            {gCounts.reprovado > 0 && (
              <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.destructive}`}>
                ✕ {gCounts.reprovado}
              </span>
            )}
            {validationAlertCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                    <ShieldAlert className="h-3 w-3" /> Validação ({validationAlertCount})
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    {validationAlertCount} alerta(s) de regras assistenciais nesta empresa.
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {nfDivergent && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${TONE_CLASSES.destructive}`}>
                    <Receipt className="h-3 w-3" /> NF divergente
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">
                    NF recebida: {formatCurrency(nfReceivedTotal)} · Bruto do pedido: {formatCurrency(Number(g.total_amount))} · Diferença: {formatCurrency(nfDiff)}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1.5">
            {groupMaxScore > 0 && (
            <RiskBadge 
              level={groupRisk} 
              score={groupMaxScore} 
              title={`Score de impacto financeiro: ${groupMaxScore}`} 
              reasons={groupMaxBreakdown?.reasons}
              financialData={groupMaxBreakdown}
            />
            )}
          <StatusBadge status={gStatus} />
        </div>
      </div>
      </button>

      {groupExpandedEffective && nfDivergent && (
        <div className="border-t border-border/60 bg-destructive/5">
          <div className="flex items-start gap-2 px-4 py-3 text-xs">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-destructive">
                Divergência entre o valor bruto do pedido e a nota fiscal recebida
              </p>
              <p className="text-muted-foreground mt-0.5">
                Bruto do pedido: <span className="text-foreground tabular-nums">{formatCurrency(Number(g.total_amount))}</span> · NF recebida: <span className="text-foreground tabular-nums">{formatCurrency(nfReceivedTotal)}</span> · Diferença: <span className="text-destructive tabular-nums font-medium">{formatCurrency(nfDiff)}</span>
              </p>
              <p className="text-muted-foreground mt-1">
                Resolva na página dedicada: corrija o pedido ou solicite reemissão da nota.
              </p>
            </div>
          </div>
        </div>
      )}

      {groupExpandedEffective && (groupRisk === "alto" || groupRisk === "critico") && (
        <div
          className={cn(
            "border-t flex items-center gap-2 px-4 py-2 text-xs",
            groupRisk === "critico"
              ? "border-destructive/30 bg-destructive-soft text-destructive"
              : "border-warning/30 bg-warning-soft text-warning-foreground",
          )}
          role={groupRisk === "critico" ? "alert" : "status"}
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <p className="leading-snug">
            <span className="font-semibold">
              {groupRisk === "critico" ? "Ação obrigatória:" : "Priorize a revisão:"}
            </span>{" "}
            {groupRisk === "critico"
              ? "há reprovações ou bloqueios neste grupo — analise antes de aprovar para pagamento."
              : "vários sinais somados elevaram o risco — confira os itens marcados antes de seguir."}
            {groupMaxScore > 0 && <span className="opacity-80"> Score: {groupMaxScore}.</span>}
          </p>
        </div>
      )}

      {groupExpandedEffective && groupAlerts.length > 0 && (
        <div className="border-t border-border/60 bg-info-soft/30">
          <button
            type="button"
            onClick={onToggleAiOpen}
            className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-info-soft/50 transition-colors text-xs"
            aria-expanded={isAiOpen}
          >
            {isAiOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-semibold">Parecer da IA</span>
            <span className="text-muted-foreground">
              — {groupAlerts.length} item(ns) com observação
              {analystDone && " · revisado pelo analista"}
            </span>
          </button>
          {isAiOpen && (
            <ul className="divide-y divide-border/40 border-t border-border/40 bg-background/60">
              {groupAlerts.slice(0, 6).map(({ item, alerts }) => {
                const tone: keyof typeof TONE_CLASSES = analystDone
                  ? "muted"
                  : item.ai_status === "reprovado"
                  ? "destructive"
                  : item.ai_status === "alerta"
                  ? "warning"
                  : "muted";
                const raw = (item.raw_data ?? {}) as Record<string, unknown>;
                const paciente = (raw["Paciente"] ?? raw["paciente"] ?? null) as string | null;
                const iBreakdown = scoreItem(item);
                return (
                  <li key={item.id} className="px-4 py-2 text-xs">
                    <div className="flex items-start gap-2">
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
                          tone === "destructive"
                            ? "bg-destructive"
                            : tone === "warning"
                            ? "bg-warning"
                            : "bg-muted-foreground"
                        }`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          {iBreakdown.score > 0 && (
                            <RiskBadge 
                              level={iBreakdown.level} 
                              score={iBreakdown.score} 
                              showLabel={false} 
                              reasons={iBreakdown.reasons}
                            />
                          )}
                          {item.attendance_number && (
                            <span className="font-mono">Atend. #{item.attendance_number}</span>
                          )}
                          {paciente && (
                            <span>· Paciente: <span className="text-foreground">{paciente}</span></span>
                          )}
                          <span>· Médico: <span className="text-foreground">{item.doctor_name}</span></span>
                          {item.procedure_code && (
                            <span>· Procedimento: <span className="font-mono text-foreground">{item.procedure_code}</span></span>
                          )}
                        </div>
                        <ul className="space-y-0.5">
                          {alerts.map((a, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span className="text-muted-foreground">•</span>
                              <span className="whitespace-pre-wrap">{a}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </li>
                );
              })}
              {groupAlerts.length > 6 && (
                <li className="px-4 py-2 text-[11px] text-muted-foreground italic">
                  +{groupAlerts.length - 6} item(ns) com observação — veja todos na análise dedicada.
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {groupExpandedEffective && (() => {
        // Resumo por atendimento: base, complemento, glosa
        const byAtt = new Map<string, { att: string; base: number; compl: number; glosa: number }>();
        for (const it of groupItems) {
          const att = (it.attendance_number ?? "").trim();
          if (!att) continue;
          const cur = byAtt.get(att) ?? { att, base: 0, compl: 0, glosa: 0 };
          const tl = (it as unknown as { tipo_linha?: string | null }).tipo_linha ?? null;
          const v = Number(it.gross_amount ?? 0);
          if (tl === "complemento_bonus") cur.compl += v;
          else if (tl === "glosa_desconto") cur.glosa += v;
          else cur.base += v;
          byAtt.set(att, cur);
        }
        const withCompl = Array.from(byAtt.values())
          .filter((g) => g.compl !== 0 || g.glosa !== 0)
          .sort((a, b) => (attendanceScores.get(b.att)?.score ?? 0) - (attendanceScores.get(a.att)?.score ?? 0));
        if (withCompl.length === 0) return null;
        return (
          <div className="border-t border-border/60 bg-muted/30 px-4 py-2 text-[11px]">
            <div className="font-semibold mb-1 text-muted-foreground uppercase tracking-wider text-[10px]">
              Atendimentos com complemento/glosa
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
              {withCompl.map((row) => {
                const total = row.base + row.compl + row.glosa;
                const sc = attendanceScores.get(row.att);
                return (
                  <li key={row.att} className="font-mono flex items-center gap-1.5 flex-wrap">
                    {sc && sc.score > 0 && (
                      <RiskBadge 
                        level={sc.level} 
                        score={sc.score} 
                        showLabel={false} 
                        reasons={sc.reasons}
                      />
                    )}
                    <span>
                      Atend. #{row.att}: base {formatCurrency(row.base)}
                      {row.compl !== 0 && <> · compl {formatCurrency(row.compl)}</>}
                      {row.glosa !== 0 && <> · glosa {formatCurrency(row.glosa)}</>}
                      {" "}= <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      {groupExpandedEffective && (
        <CardContent className="border-t border-border/60 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-muted-foreground">
              Toda análise, comentários e ações de fluxo desta empresa acontecem na página dedicada — abrir mantém o mesmo conjunto de dados, apenas com o ambiente de trabalho completo.
            </div>
            <Button asChild size="sm">
              <Link to={dedicatedHref}>
                Abrir análise da empresa <ArrowRight className="h-4 w-4 ml-1.5" />
              </Link>
            </Button>
          </div>
        </CardContent>
      )}
    </SafeCard>
  );
};

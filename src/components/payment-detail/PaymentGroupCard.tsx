import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type RowDensity = "compact" | "comfortable";
const DENSITY_LS_KEY = "paymentGroupCard.density.v1";
const readDensity = (): RowDensity => {
  if (typeof window === "undefined") return "compact";
  const v = window.localStorage.getItem(DENSITY_LS_KEY);
  return v === "comfortable" ? "comfortable" : "compact";
};
import { Link, useParams } from "react-router-dom";
import { StatusBadge } from "@/components/StatusBadge";
import { PaymentItemRow } from "@/components/payment-detail/PaymentItemRow";
import { CompanyAnalysisDialog } from "@/components/payment-detail/CompanyAnalysisDialog";
import { Maximize2 } from "lucide-react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Receipt,
  RefreshCcw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  XCircle,
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
  resolveResendTarget,
} from "@/lib/paymentFlow";
import type {
  GroupRow,
  InvoiceRow,
  ObservationRow,
  PaymentItemRow as PaymentItemRowData,
  RuleLite,
} from "@/hooks/usePaymentDetailData";
import { scoreAttendance, classifyRisk, RISK_LABELS } from "@/lib/riskScore";
import { RiskBadge } from "./RiskBadge";

function DedicatedAnalysisLink({ groupId }: { groupId: string }) {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={`/pagamentos/${id}/empresa/${groupId}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Abrir análise em página dedicada"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </TooltipTrigger>
      <TooltipContent>Abrir página dedicada</TooltipContent>
    </Tooltip>
  );
}

export type PaymentGroupCardProps = {
  g: GroupRow;
  /** Itens já filtrados pela busca quando aplicável (groupItems). */
  groupItems: PaymentItemRowData[];
  /** Indica se a busca atual já casou com o nome do grupo (afeta a expansão forçada). */
  searchActive: boolean;
  obs: ObservationRow[];
  invoices: InvoiceRow[];
  profiles: Record<string, string>;
  rulesIndex: Record<string, RuleLite>;
  rulesByName: Record<string, RuleLite>;

  // Estado controlado pelo parent (mantido global pois a página inteira lê).
  isExpanded: boolean;
  onToggleExpanded: () => void;
  isAiOpen: boolean;
  onToggleAiOpen: () => void;
  expandedItems: Set<string>;
  onToggleItemExpanded: (itemId: string) => void;

  // Comentários
  canComment: boolean;
  itemCommentDraft: Record<string, string>;
  onItemCommentDraftChange: (itemId: string, value: string) => void;
  onAddItemComment: (itemId: string) => void;
  groupCommentDraft: string;
  onGroupCommentDraftChange: (value: string) => void;

  // Permissões para a barra inferior
  isAnalista: boolean;
  isValidador: boolean;
  isDiretor: boolean;

  // Ações
  busy: boolean;
  reanalyzingGroupId: string | null;
  onReanalyze: (g: GroupRow) => void;
  onResend: (groupId: string) => void;
  onSendForValidation: (groupId: string) => void;
  onTransition: (
    groupId: string,
    to: PaymentStatus,
    actor: "validador" | "diretor",
    label: string,
    requireComment?: boolean,
  ) => void;
  /** Recarregar dados após marcar/remover exceção autorizada em um item. */
  onExceptionChanged?: () => void;
};

/**
 * Card de uma empresa (grupo) dentro do pagamento.
 *
 * - Calcula localmente: status efetivos, contadores de itens, alertas da IA,
 *   conferência bruto x NF (por empresa), e quem foi o "devolvedor" para o
 *   botão "Reencaminhar ao …".
 * - Renderiza tabela de items via <PaymentItemRow/> (PR #3).
 * - Toda mutação (transição/reanálise/envio) é delegada via callbacks ao
 *   parent — assim a regra de negócio segue centralizada no PaymentDetail.
 */
export const PaymentGroupCard = ({
  g,
  groupItems,
  searchActive,
  obs,
  invoices,
  profiles,
  rulesIndex,
  rulesByName,
  isExpanded,
  onToggleExpanded,
  isAiOpen,
  onToggleAiOpen,
  expandedItems,
  onToggleItemExpanded,
  canComment,
  itemCommentDraft,
  onItemCommentDraftChange,
  onAddItemComment,
  groupCommentDraft,
  onGroupCommentDraftChange,
  isAnalista,
  isValidador,
  isDiretor,
  busy,
  reanalyzingGroupId,
  onReanalyze,
  onResend,
  onSendForValidation,
  onTransition,
  onExceptionChanged,
}: PaymentGroupCardProps) => {
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [density, setDensity] = useState<RowDensity>(() => readDensity());
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(DENSITY_LS_KEY, density);
  }, [density]);
  const isComfy = density === "comfortable";
  const gStatus = g.status as PaymentStatus;
  const isGroupAnalista = isAnalista && (gStatus === "revisao_analista" || gStatus === "devolvido_analista");
  const isGroupValidador = isValidador && gStatus === "aguardando_validacao";
  const isGroupDiretor = isDiretor && gStatus === "aguardando_aprovacao";
  // Se o analista já concluiu a triagem, o parecer da IA não é mais alerta
  // ativo: vira informativo e deixa de pintar o item como "reprovado".
  const analystDone = ANALYST_DONE_STATUSES.has(gStatus);
  const groupAlerts = groupItems
    .filter((it) => (it.ai_findings?.alerts ?? []).length > 0)
    .map((it) => ({ item: it, alerts: it.ai_findings!.alerts as string[] }));
  const gCounts = groupItems.reduce(
    (acc, it) => {
      const eff = effectiveItemAiStatus(it.ai_status as ItemAiStatus, gStatus);
      // "seguido" conta como aprovado para fins de resumo no header da empresa.
      const bucket: ItemAiStatus = eff === "seguido" ? "aprovado" : eff;
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    },
    { pendente: 0, aprovado: 0, alerta: 0, reprovado: 0 } as Record<ItemAiStatus, number>,
  );
  const returnerForResend =
    gStatus === "devolvido_analista"
      ? resolveResendTarget(obs, g.company_name)?.role ?? null
      : null;
  // Conferência bruto x NF (por empresa, tolerância zero):
  // - Considera apenas notas RECEBIDAS deste grupo (received_amount não nulo).
  // - Não trava se ainda não há NF (decisão de produto).
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
  // Quando há busca ativa, força a expansão para não esconder os itens que casaram.
  const groupExpandedEffective = searchActive ? true : isExpanded;

  // === Priorização por risco ===
  // Agrupa itens por atendimento, calcula score e ordena (desc).
  // Itens sem nº de atendimento ficam no fim, mantendo ordem original.
  const attendanceMap = new Map<string, PaymentItemRowData[]>();
  const noAttendance: PaymentItemRowData[] = [];
  for (const it of groupItems) {
    const att = (it.attendance_number ?? "").trim();
    if (!att) noAttendance.push(it);
    else {
      const arr = attendanceMap.get(att) ?? [];
      arr.push(it);
      attendanceMap.set(att, arr);
    }
  }
  const attendanceScores = new Map<string, ReturnType<typeof scoreAttendance>>();
  for (const [att, arr] of attendanceMap) {
    attendanceScores.set(att, scoreAttendance(arr));
  }
  const sortedAttendances = Array.from(attendanceMap.entries()).sort(
    (a, b) => (attendanceScores.get(b[0])!.score) - (attendanceScores.get(a[0])!.score),
  );
  const orderedItems: PaymentItemRowData[] = [
    ...sortedAttendances.flatMap(([, arr]) => arr),
    ...noAttendance,
  ];
  const groupMaxScore = Math.max(
    0,
    ...Array.from(attendanceScores.values()).map((s) => s.score),
  );
  const groupRisk = classifyRisk(groupMaxScore);

  return (
    <Card className="shadow-card">
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
          <span className="text-base font-semibold truncate">{g.company_name}</span>
          <span className="text-xs text-muted-foreground">
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
        <div className="flex items-center gap-1.5 shrink-0">
          {groupMaxScore > 0 && (
            <RiskBadge level={groupRisk} score={groupMaxScore} title={`Maior score de atendimento: ${groupMaxScore}`} />
          )}
          <StatusBadge status={gStatus} />
          <div onClick={(e) => e.stopPropagation()}>
            <ToggleGroup
              type="single"
              size="sm"
              value={density}
              onValueChange={(v) => v && setDensity(v as RowDensity)}
              className="h-7 rounded-md border border-border bg-background"
              aria-label="Densidade da tabela"
            >
              <ToggleGroupItem value="compact" className="h-6 px-2 text-[10px]" title="Compacto (padrão analista)">
                Compacto
              </ToggleGroupItem>
              <ToggleGroupItem value="comfortable" className="h-6 px-2 text-[10px]" title="Confortável">
                Confortável
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setAnalysisOpen(true); }}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Abrir análise em modo planilha"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Análise em modo planilha</TooltipContent>
          </Tooltip>
          <DedicatedAnalysisLink groupId={g.id} />
        </div>
      </button>

      <CompanyAnalysisDialog
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
        group={g}
        items={groupItems}
        rulesIndex={rulesIndex}
        rulesByName={rulesByName}
        observations={obs}
      />

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
                O analista precisa resolver com a empresa antes de reencaminhar — corrija o pedido ou solicite reemissão da nota.
              </p>
            </div>
          </div>
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
              {groupAlerts.map(({ item, alerts }) => {
                // Quando o analista já concluiu, baixamos o tom: vira info, não destrutivo.
                const tone: keyof typeof TONE_CLASSES = analystDone
                  ? "muted"
                  : item.ai_status === "reprovado"
                  ? "destructive"
                  : item.ai_status === "alerta"
                  ? "warning"
                  : "muted";
                const raw = (item.raw_data ?? {}) as Record<string, unknown>;
                const paciente = (raw["Paciente"] ?? raw["paciente"] ?? null) as string | null;
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
            </ul>
          )}
        </div>
      )}

      {groupExpandedEffective && (
        <CardContent className="p-0 print:overflow-visible">
          {(() => {
            // Resumo por atendimento: base, complemento, total
            const byAtt = new Map<string, { att: string; base: number; compl: number; glosa: number }>();
            for (const it of groupItems) {
              const att = (it.attendance_number ?? "").trim();
              if (!att) continue;
              const key = att;
              const cur = byAtt.get(key) ?? { att, base: 0, compl: 0, glosa: 0 };
              const tl = (it as any).tipo_linha as string | null;
              const v = Number(it.gross_amount ?? 0);
              if (tl === "complemento_bonus") cur.compl += v;
              else if (tl === "glosa_desconto") cur.glosa += v;
              else cur.base += v;
              byAtt.set(key, cur);
            }
            const withCompl = Array.from(byAtt.values())
              .filter((g) => g.compl !== 0 || g.glosa !== 0)
              .sort((a, b) => (attendanceScores.get(b.att)?.score ?? 0) - (attendanceScores.get(a.att)?.score ?? 0));
            if (withCompl.length === 0) return null;
            return (
              <div className="border-b border-border/60 bg-muted/30 px-4 py-2 text-[11px]">
                <div className="font-semibold mb-1 text-muted-foreground uppercase tracking-wider text-[10px]">
                  Atendimentos com complemento/glosa
                </div>
                <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-0.5">
                  {withCompl.map((g) => {
                    const total = g.base + g.compl + g.glosa;
                    const sc = attendanceScores.get(g.att);
                    return (
                      <li key={g.att} className="font-mono flex items-center gap-1.5 flex-wrap">
                        {sc && sc.score > 0 && (
                          <RiskBadge level={sc.level} score={sc.score} showLabel={false} />
                        )}
                        <span>
                          Atend. #{g.att}: base {formatCurrency(g.base)}
                          {g.compl !== 0 && <> · compl {formatCurrency(g.compl)}</>}
                          {g.glosa !== 0 && <> · glosa {formatCurrency(g.glosa)}</>}
                          {" "}= <span className="font-semibold text-foreground">{formatCurrency(total)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
          <div className="w-full max-h-[70vh] overflow-auto print:overflow-visible print:max-h-none rounded-md border border-border/60">
          <table className={`w-full min-w-[1100px] ${isComfy ? "text-[14px]" : "text-[13px]"} table-fixed border-collapse print:text-[10px] print:min-w-0`} data-density={density}>
            <colgroup>
              <col className="w-6" />
              <col className="w-[80px]" />
              <col className="w-[180px]" />
              <col className="w-[140px] hidden md:table-column print:table-column" />
              <col className="w-[180px]" />
              <col className="w-[80px] hidden lg:table-column print:table-column" />
              <col />
              <col className="w-[48px]" />
              <col className="w-[120px]" />
              <col className="w-[80px] hidden sm:table-column print:table-column" />
              <col className="w-8 print:hidden" />
            </colgroup>
            <thead className={`text-left ${isComfy ? "text-[12px]" : "text-[11px]"} font-semibold uppercase tracking-wider text-muted-foreground print:static`}>
              <tr className="[&>th]:sticky [&>th]:top-0 [&>th]:bg-muted [&>th]:z-10 [&>th]:shadow-[0_1px_0_0_hsl(var(--border))]">
                <th className="px-2.5 py-2 print:hidden !left-0 md:!sticky !z-20"></th>
                <th className="px-2.5 py-2 !left-6 md:!sticky !z-20">Atend.</th>
                <th className="px-2.5 py-2 !left-[104px] md:!sticky !z-20">Paciente</th>
                <th className="px-2.5 py-2 hidden md:table-cell print:table-cell">Convênio</th>
                <th className="px-2.5 py-2">Médico / Função</th>
                <th className="px-2.5 py-2 hidden lg:table-cell print:table-cell">TUSS</th>
                <th className="px-2.5 py-2">Descrição</th>
                <th className="px-2.5 py-2 text-right">Qtd</th>
                <th className="px-2.5 py-2 text-right">Valor</th>
                <th className="px-2.5 py-2 hidden sm:table-cell print:table-cell">IA</th>
                <th className="px-2.5 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {orderedItems.map((it, idx) => (
                <PaymentItemRow
                  key={it.id}
                  it={it}
                  paymentId={g.payment_id}
                  obs={obs}
                  profiles={profiles}
                  rulesIndex={rulesIndex}
                  rulesByName={rulesByName}
                  isExpanded={expandedItems.has(it.id)}
                  onToggleExpanded={onToggleItemExpanded}
                  analystDone={analystDone}
                  canComment={canComment}
                  commentDraft={itemCommentDraft[it.id] ?? ""}
                  onCommentDraftChange={(v) => onItemCommentDraftChange(it.id, v)}
                  onAddComment={() => onAddItemComment(it.id)}
                  busy={busy}
                  density={density}
                  onExceptionChanged={onExceptionChanged}
                  hasPrev={idx > 0}
                  hasNext={idx < orderedItems.length - 1}
                  onNavigate={(dir) => {
                    const target = orderedItems[dir === "prev" ? idx - 1 : idx + 1];
                    if (!target) return;
                    // Fecha o atual e abre o vizinho — toggle é idempotente para o pai.
                    onToggleItemExpanded(it.id);
                    onToggleItemExpanded(target.id);
                  }}
                />
              ))}
            </tbody>
          </table>
          </div>
        </CardContent>
      )}

      {groupExpandedEffective && (isGroupAnalista || isGroupValidador || isGroupDiretor) && (
        <div className="border-t border-border bg-muted/20 p-4 space-y-2">
          <Textarea
            rows={2}
            value={groupCommentDraft}
            onChange={(e) => onGroupCommentDraftChange(e.target.value)}
            placeholder="Observação para esta empresa (obrigatória para devolver/rejeitar)..."
          />
          <div className="flex flex-wrap gap-2 justify-end">
            {isGroupAnalista && (
              <>
                <Button
                  variant="outline"
                  onClick={() => onReanalyze(g)}
                  disabled={busy || reanalyzingGroupId === g.id}
                >
                  <RefreshCcw className={`h-4 w-4 mr-2 ${reanalyzingGroupId === g.id ? "animate-spin" : ""}`} />
                  {reanalyzingGroupId === g.id ? "Reaplicando..." : "Reaplicar regras"}
                </Button>
                {returnerForResend ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button onClick={() => onResend(g.id)} disabled={busy || nfDivergent}>
                          <Send className="h-4 w-4 mr-2" />
                          Reencaminhar ao {returnerForResend}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {nfDivergent && (
                      <TooltipContent>NF divergente: ajuste o pedido ou peça reemissão antes de reencaminhar.</TooltipContent>
                    )}
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button onClick={() => onSendForValidation(g.id)} disabled={busy || nfDivergent}>
                          <Send className="h-4 w-4 mr-2" /> Enviar esta empresa para validação
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {nfDivergent && (
                      <TooltipContent>NF divergente: ajuste o pedido ou peça reemissão antes de enviar.</TooltipContent>
                    )}
                  </Tooltip>
                )}
              </>
            )}
            {isGroupValidador && (
              <>
                <Button
                  variant="outline"
                  onClick={() => onReanalyze(g)}
                  disabled={busy || reanalyzingGroupId === g.id}
                >
                  <RefreshCcw className={`h-4 w-4 mr-2 ${reanalyzingGroupId === g.id ? "animate-spin" : ""}`} />
                  {reanalyzingGroupId === g.id ? "Reanalisando..." : "Reanalisar com IA"}
                </Button>
                <Button
                  onClick={() => onTransition(g.id, "aguardando_aprovacao", "validador", "Validado", false)}
                  disabled={busy}
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" /> Validar empresa
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onTransition(g.id, "devolvido_analista", "validador", "Devolvido ao analista")}
                  disabled={busy}
                >
                  <RotateCcw className="h-4 w-4 mr-2" /> Devolver ao analista
                </Button>
              </>
            )}
            {isGroupDiretor && (
              <>
                <Button
                  variant="outline"
                  onClick={() => onReanalyze(g)}
                  disabled={busy || reanalyzingGroupId === g.id}
                >
                  <RefreshCcw className={`h-4 w-4 mr-2 ${reanalyzingGroupId === g.id ? "animate-spin" : ""}`} />
                  {reanalyzingGroupId === g.id ? "Reanalisando..." : "Reanalisar com IA"}
                </Button>
                <Button
                  onClick={() => onTransition(g.id, "aprovado", "diretor", "Aprovado", false)}
                  disabled={busy}
                >
                  <ShieldCheck className="h-4 w-4 mr-2" /> Aprovar empresa
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onTransition(g.id, "devolvido_analista", "diretor", "Devolvido ao analista")}
                  disabled={busy}
                >
                  <RotateCcw className="h-4 w-4 mr-2" /> Devolver ao analista
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => onTransition(g.id, "rejeitado", "diretor", "Rejeitado")}
                  disabled={busy}
                >
                  <XCircle className="h-4 w-4 mr-2" /> Rejeitar empresa
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
};
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveHospitalId } from "@/contexts/HospitalContext";
import { formatCurrency, type PaymentStatus } from "@/lib/status";
import {
  Activity, Clock, RotateCcw, CheckCircle2, Receipt, AlertTriangle,
  TrendingUp, ArrowUp, ArrowDown, AlertCircle, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildWindows, computeMetrics, deltaPct, deltaPoints,
  type HistoryLite, type InvoiceLite, type ObsLite, type PaymentLite,
} from "@/lib/kpiMetrics";
import InterventionSavingsCard from "@/components/kpis/InterventionSavingsCard";
import CancelledPaymentsCard from "@/components/kpis/CancelledPaymentsCard";

type Range = 7 | 30 | 90;

const fmtHours = (h: number | null) => {
  if (h == null || !isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};
const pctStr = (p: number | null) => (p == null ? "—" : `${Math.round(p)}%`);

const stageBuckets: { label: string; statuses: PaymentStatus[]; tone: string }[] = [
  { label: "Em análise", statuses: ["em_analise_ia", "revisao_analista"], tone: "bg-info" },
  { label: "Validação", statuses: ["aguardando_validacao"], tone: "bg-warning" },
  { label: "Aprovação", statuses: ["aguardando_aprovacao"], tone: "bg-warning" },
  { label: "NF solicitada", statuses: ["aprovado", "pedido_nf_enviado", "aprovado_em_revisao"], tone: "bg-info" },
  { label: "NF recebida", statuses: ["nf_recebida"], tone: "bg-info" },
  { label: "NF conciliada", statuses: ["nf_conciliada"], tone: "bg-success" },
  { label: "Pago", statuses: ["pago"], tone: "bg-success" },
  { label: "Devolvido / questionado", statuses: ["devolvido_analista", "nf_questionada", "aprovado_com_ressalva"], tone: "bg-destructive" },
  { label: "Rejeitado", statuses: ["rejeitado"], tone: "bg-muted" },
];

const Kpis = () => {
  const { user, hasRole } = useAuth();
  const activeHospitalId = useActiveHospitalId();
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [paymentsPrev, setPaymentsPrev] = useState<PaymentLite[]>([]);
  const [obs, setObs] = useState<ObsLite[]>([]);
  const [obsPrev, setObsPrev] = useState<ObsLite[]>([]);
  const [history, setHistory] = useState<HistoryLite[]>([]);
  const [historyPrev, setHistoryPrev] = useState<HistoryLite[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [invoicesPrev, setInvoicesPrev] = useState<InvoiceLite[]>([]);
  const [historicalIds, setHistoricalIds] = useState<Set<string>>(new Set());
  const [historicalCount, setHistoricalCount] = useState(0);

  const isAdmin = hasRole("admin");
  const isDiretor = hasRole("diretor");
  const isValidador = hasRole("validador");
  const isAnalista = hasRole("analista");
  const seesAll = isAdmin || isDiretor;
  const invoicesUnscoped = seesAll || isValidador;


  useEffect(() => {
    document.title = "KPIs | Exacta";
    // KPIs somam pagamentos/observações — todos hospital-scoped via RLS.
    if (!activeHospitalId) {
      setPayments([]); setPaymentsPrev([]); setObs([]); setObsPrev([]);
      setHistory([]); setHistoryPrev([]); setInvoices([]); setInvoicesPrev([]);
      setHistoricalIds(new Set()); setHistoricalCount(0); setLoading(false);
      return;
    }
    const { sinceCurr, sincePrev, untilPrev } = buildWindows(range);
    setLoading(true);

    const cols = "id,status,total_amount,liquido_total,created_at,updated_at,approved_at,validated_at,created_by,validated_by,approved_by";

    Promise.all([
      supabase.from("payments").select(cols).gte("created_at", sinceCurr).order("created_at", { ascending: false }).limit(1000),
      supabase.from("payments").select(cols).gte("created_at", sincePrev).lt("created_at", untilPrev).limit(1000),
      supabase.from("payment_observations").select("payment_id,status_from,status_to,created_at").gte("created_at", sinceCurr).limit(2000),
      supabase.from("payment_observations").select("payment_id,status_from,status_to,created_at").gte("created_at", sincePrev).lt("created_at", untilPrev).limit(2000),
      supabase.from("payment_status_history").select("payment_id,status_from,status_to,changed_at").gte("changed_at", sinceCurr).limit(5000),
      supabase.from("payment_status_history").select("payment_id,status_from,status_to,changed_at").gte("changed_at", sincePrev).lt("changed_at", untilPrev).limit(5000),
      supabase.from("invoices").select("id,status,payment_id,created_at,ai_validation").gte("created_at", sinceCurr).limit(1000),
      supabase.from("invoices").select("id,status,payment_id,created_at,ai_validation").gte("created_at", sincePrev).lt("created_at", untilPrev).limit(1000),
      (supabase as any).from("v_payments_flow_scope").select("payment_id").eq("is_historical", true).gte("created_at", sincePrev).limit(2000),
    ]).then(([p, pPrev, o, oPrev, h, hPrev, i, iPrev, hist]) => {
      setPayments((p.data ?? []) as PaymentLite[]);
      setPaymentsPrev((pPrev.data ?? []) as PaymentLite[]);
      setObs((o.data ?? []) as ObsLite[]);
      setObsPrev((oPrev.data ?? []) as ObsLite[]);
      setHistory((h.data ?? []) as HistoryLite[]);
      setHistoryPrev((hPrev.data ?? []) as HistoryLite[]);
      setInvoices((i.data ?? []) as InvoiceLite[]);
      setInvoicesPrev((iPrev.data ?? []) as InvoiceLite[]);
      const ids = new Set<string>(((hist?.data ?? []) as { payment_id: string }[]).map((r) => r.payment_id));
      setHistoricalIds(ids);
      setHistoricalCount(ids.size);
      setLoading(false);
    });
  }, [range, activeHospitalId]);

  const filterByRole = (list: PaymentLite[]) => {
    const base = list.filter((p) => !historicalIds.has(p.id));
    if (seesAll || isValidador) return base;
    if (isAnalista && user?.id) return base.filter((p) => p.created_by === user.id);
    return [];
  };

  const myPayments = useMemo(() => filterByRole(payments), [payments, historicalIds, seesAll, isValidador, isAnalista, user?.id]);
  const myPaymentsPrev = useMemo(() => filterByRole(paymentsPrev), [paymentsPrev, historicalIds, seesAll, isValidador, isAnalista, user?.id]);


  const metrics = useMemo(() => computeMetrics({
    payments: myPayments, observations: obs, history, invoices, rangeDays: range, invoicesUnscoped,
  }), [myPayments, obs, history, invoices, range, invoicesUnscoped]);
  const metricsPrev = useMemo(() => computeMetrics({
    payments: myPaymentsPrev, observations: obsPrev, history: historyPrev, invoices: invoicesPrev, rangeDays: range, invoicesUnscoped,
  }), [myPaymentsPrev, obsPrev, historyPrev, invoicesPrev, range, invoicesUnscoped]);

  const bottleneck = useMemo(() => {
    if (!myPayments.length) return null;
    let best: { label: string; count: number } | null = null;
    for (const b of stageBuckets) {
      const c = myPayments.filter((p) => b.statuses.includes(p.status)).length;
      if (!best || c > best.count) best = { label: b.label, count: c };
    }
    if (!best || best.count === 0) return null;
    return { ...best, total: myPayments.length };
  }, [myPayments]);

  return (
    <>
      <PageHeader title="KPIs" description="Métricas de eficiência do fluxo de pagamento." />
      <div className="p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Janela:</span>
          {[7, 30, 90].map((r) => (
            <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r as Range)}>
              {r} dias
            </Button>
          ))}
          <span className="text-xs text-muted-foreground ml-auto">
            {seesAll ? "Visão completa" : isValidador ? "Visão da equipe" : "Apenas suas bases"}
            {" · Variação vs "}{range} dias anteriores.
            {historicalCount > 0 && (
              <> {" · "}<span title="Lotes lançados direto sem passar por validação/aprovação são excluídos das métricas de fluxo, mas contam em DRE, conciliação e volumetria.">{historicalCount} {historicalCount === 1 ? "lote histórico excluído" : "lotes históricos excluídos"}</span></>
            )}
          </span>

        </div>

        {!loading && bottleneck && (
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <AlertCircle className="h-5 w-5 text-warning-text mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs uppercase tracking-wider text-warning-text font-medium">Gargalo atual</p>
              <p className="text-sm mt-1">
                <span className="font-semibold">{bottleneck.label}</span>{" "}
                concentra <span className="font-semibold tabular-nums">{Math.round((bottleneck.count / bottleneck.total) * 100)}%</span> das bases
                {" "}({bottleneck.count} de {bottleneck.total}).
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-lg" />)}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Pares de grupos lado-a-lado em telas ≥xl. Cada grupo mantém 2 colunas internas */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6 gap-y-6">
              <KpiGroup title="Volume">
                <KpiCard icon={Activity} label="Bases criadas" value={String(metrics.total)} hint={formatCurrency(metrics.valor)}
                  definition="Pagamentos com created_at dentro da janela selecionada (após o filtro de papel)."
                  delta={deltaPct(metrics.total, metricsPrev.total)} higherIsBetter />
                <KpiCard icon={TrendingUp} label="Throughput" value={`${metrics.throughput.toFixed(1)}/dia`} hint={`média em ${range} dias`} tone="info"
                  definition={`Bases criadas ÷ ${range} dias. Mede ritmo médio de chegada.`}
                  delta={deltaPct(metrics.throughput, metricsPrev.throughput)} higherIsBetter />
              </KpiGroup>

              <KpiGroup title="Velocidade">
                <KpiCard icon={Clock} label="Tempo até validação" value={fmtHours(metrics.ttValid)} hint={`${metrics.validadosCount} validadas`} tone="info"
                  definition="Média de (primeiro changed_at com status_to = 'aguardando_aprovacao' em payment_status_history) − created_at. Pagamentos sem essa transição NÃO entram na média (não contam zero). Usa validated_at apenas como fallback quando não há transição no histórico."
                  delta={deltaPct(metrics.ttValid, metricsPrev.ttValid)} higherIsBetter={false} />
                <KpiCard icon={Clock} label="Tempo até aprovação" value={fmtHours(metrics.ttApprov)} hint={`${metrics.aprovadosCount} aprovadas`}
                  definition="Média de (primeiro changed_at com status_to ∈ {'aprovado','aprovado_em_revisao'}) − created_at. Pagamentos sem essa transição não entram. approved_at usado só como fallback."
                  delta={deltaPct(metrics.ttApprov, metricsPrev.ttApprov)} higherIsBetter={false} />
              </KpiGroup>

              <KpiGroup title="Qualidade">
                <KpiCard icon={RotateCcw} label="Taxa de devolução" value={pctStr(metrics.taxaDevolucao)} hint={`${metrics.devolucoes} eventos`} tone="warning"
                  definition="Eventos em payment_observations com status_to = 'devolvido_analista' ÷ total de bases criadas no período."
                  delta={deltaPoints(metrics.taxaDevolucao, metricsPrev.taxaDevolucao)} higherIsBetter={false} unit="pp" />
                <KpiCard icon={AlertTriangle} label="Taxa de divergência NF" value={pctStr(metrics.taxaDivergencia)} hint={`${metrics.nfDiv} divergentes`} tone="destructive"
                  definition="NFs com status 'divergente' OU ai_validation.divergences > 0, dividido pelo total de NFs criadas na janela."
                  delta={deltaPoints(metrics.taxaDivergencia, metricsPrev.taxaDivergencia)} higherIsBetter={false} unit="pp" />
              </KpiGroup>

              <KpiGroup title="Saída">
                <KpiCard icon={CheckCircle2} label="Taxa de conclusão" value={pctStr(metrics.taxaConclusao)} hint={`${metrics.pagos} pagas / ${metrics.rejeitados} rejeitadas`} tone="success"
                  definition="Bases em status 'pago' ou 'arquivado' ÷ total de bases criadas na janela."
                  delta={deltaPoints(metrics.taxaConclusao, metricsPrev.taxaConclusao)} higherIsBetter unit="pp" />
                <KpiCard icon={Receipt} label="NFs no período" value={String(metrics.nfTotal)} hint={`${metrics.nfConc} conciliadas`}
                  definition={`NFs criadas dentro da janela. ${invoicesUnscoped ? "Visão agregada (todas)." : "Restrito às suas bases."}`}
                  delta={deltaPct(metrics.nfTotal, metricsPrev.nfTotal)} higherIsBetter />
              </KpiGroup>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card className="shadow-card xl:col-span-2 xl:row-span-2">
            <CardHeader><CardTitle className="text-base">Distribuição por etapa atual</CardTitle></CardHeader>
            <CardContent>
              {loading ? <Skeleton className="h-32" /> : <StageBreakdown payments={myPayments} />}
            </CardContent>
          </Card>
          <InterventionSavingsCard rangeDays={range} />
          <CancelledPaymentsCard rangeDays={range} />
        </div>
      </div>
    </>
  );
};

const KpiGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{title}</p>
    {/* Mobile/tablet: 1 col (empilhado). md+: 2 colunas. Em grupos pareados (xl) mantém 2 colunas internas. */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">{children}</div>
  </div>
);

const KpiCard = ({
  icon: _Icon, label, value, hint, tone = "muted", delta, higherIsBetter, unit = "%", definition,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint?: string;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  delta?: number | null; higherIsBetter?: boolean; unit?: "%" | "pp";
  definition?: string;
}) => {
  const valueTone: Record<string, string> = {
    muted: "text-foreground",
    info: "text-info",
    success: "text-success",
    warning: "text-warning-text",
    destructive: "text-destructive",
  };

  let deltaEl: React.ReactNode = null;
  if (delta != null && isFinite(delta) && Math.abs(delta) >= 0.05) {
    const up = delta > 0;
    const good = higherIsBetter ? up : !up;
    const color = good ? "text-success" : "text-destructive";
    const Arrow = up ? ArrowUp : ArrowDown;
    const display = unit === "pp"
      ? `${Math.abs(delta).toFixed(1)} pp`
      : `${Math.abs(delta).toFixed(0)}%`;
    deltaEl = (
      <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums", color)}
        aria-label={`Variação vs período anterior: ${good ? "melhor" : "pior"} em ${display}`}>
        <Arrow className="h-3 w-3" aria-hidden />{display}
      </span>
    );
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 transition-colors">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex-1 min-w-0">
          {label}
        </span>
        {definition && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`Como ${label} é calculado`}
                className="text-muted-foreground/60 hover:text-foreground transition-colors flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
              {definition}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-2 flex-wrap">
        <p className={cn("text-3xl font-semibold tracking-tight tabular-nums leading-none", valueTone[tone])}>{value}</p>
        {deltaEl}
      </div>
      {hint && <p className="text-xs text-muted-foreground mt-3">{hint}</p>}
    </div>
  );
};

const StageBreakdown = ({ payments }: { payments: PaymentLite[] }) => {
  const total = payments.length || 1;
  return (
    <div className="space-y-2">
      {stageBuckets.map((b) => {
        const c = payments.filter((p) => b.statuses.includes(p.status)).length;
        const w = (c / total) * 100;
        return (
          <div key={b.label} className="flex items-center gap-3 text-xs">
            <div className="w-44 shrink-0 text-muted-foreground">{b.label}</div>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${b.tone}`} style={{ width: `${w}%` }} />
            </div>
            <div className="w-16 text-right tabular-nums">{c} · {Math.round(w)}%</div>
          </div>
        );
      })}
    </div>
  );
};

export default Kpis;

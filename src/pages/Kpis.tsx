import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, type PaymentStatus } from "@/lib/status";
import { Activity, Clock, RotateCcw, CheckCircle2, Receipt, AlertTriangle, TrendingUp, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Range = 7 | 30 | 90;

interface PaymentLite {
  id: string;
  status: PaymentStatus;
  total_amount: number | string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  validated_at: string | null;
  created_by: string | null;
  validated_by: string | null;
  approved_by: string | null;
}

interface ObsLite {
  payment_id: string;
  status_from: PaymentStatus | null;
  status_to: PaymentStatus | null;
  created_at: string;
}

interface HistoryLite {
  payment_id: string;
  status_from: PaymentStatus | null;
  status_to: PaymentStatus | null;
  changed_at: string;
}

interface InvoiceLite {
  id: string;
  status: string;
  payment_id: string;
  created_at: string;
  ai_validation: { divergences?: string[] } | null;
}

const fmtHours = (h: number | null) => {
  if (h == null || !isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
};
const pct = (n: number, d: number) => (d === 0 ? null : (n / d) * 100);
const pctStr = (p: number | null) => (p == null ? "—" : `${Math.round(p)}%`);

type Metrics = {
  total: number;
  valor: number;
  ttApprov: number | null;
  ttValid: number | null;
  validadosCount: number;
  aprovadosCount: number;
  devolucoes: number;
  taxaDevolucao: number | null;
  pagos: number;
  rejeitados: number;
  taxaConclusao: number | null;
  nfTotal: number;
  nfDiv: number;
  nfConc: number;
  taxaDivergencia: number | null;
  throughput: number;
};

const Kpis = () => {
  const { user, hasRole } = useAuth();
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

  const isAdmin = hasRole("admin");
  const isDiretor = hasRole("diretor");
  const isValidador = hasRole("validador");
  const isAnalista = hasRole("analista");
  const seesAll = isAdmin || isDiretor;

  useEffect(() => {
    document.title = "KPIs | Exacta";
    const now = Date.now();
    const ms = range * 24 * 60 * 60 * 1000;
    const sinceCurr = new Date(now - ms).toISOString();
    const sincePrev = new Date(now - 2 * ms).toISOString();
    const untilPrev = sinceCurr;
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
    ]).then(([p, pPrev, o, oPrev, h, hPrev, i, iPrev]) => {
      setPayments((p.data ?? []) as PaymentLite[]);
      setPaymentsPrev((pPrev.data ?? []) as PaymentLite[]);
      setObs((o.data ?? []) as ObsLite[]);
      setObsPrev((oPrev.data ?? []) as ObsLite[]);
      setHistory((h.data ?? []) as HistoryLite[]);
      setHistoryPrev((hPrev.data ?? []) as HistoryLite[]);
      setInvoices((i.data ?? []) as InvoiceLite[]);
      setInvoicesPrev((iPrev.data ?? []) as InvoiceLite[]);
      setLoading(false);
    });
  }, [range]);

  const filterByRole = (list: PaymentLite[]) => {
    if (seesAll) return list;
    if (isValidador) return list;
    if (isAnalista && user?.id) return list.filter((p) => p.created_by === user.id);
    return [];
  };

  const myPayments = useMemo(() => filterByRole(payments), [payments, seesAll, isValidador, isAnalista, user?.id]);
  const myPaymentsPrev = useMemo(() => filterByRole(paymentsPrev), [paymentsPrev, seesAll, isValidador, isAnalista, user?.id]);

  const computeMetrics = (
    pmts: PaymentLite[],
    observ: ObsLite[],
    hist: HistoryLite[],
    invs: InvoiceLite[],
    days: number,
  ): Metrics => {
    const total = pmts.length;
    const valor = pmts.reduce((s, p: any) => s + Number(p.liquido_total ?? p.total_amount ?? 0), 0);
    const idSet = new Set(pmts.map((p) => p.id));
    const createdById = new Map(pmts.map((p) => [p.id, new Date(p.created_at).getTime()] as const));

    // Tempos via history (status_to)
    const firstTransition = (target: (s: PaymentStatus | null) => boolean) => {
      const byPayment = new Map<string, number>();
      for (const h of hist) {
        if (!idSet.has(h.payment_id)) continue;
        if (!target(h.status_to)) continue;
        const t = new Date(h.changed_at).getTime();
        const prev = byPayment.get(h.payment_id);
        if (prev == null || t < prev) byPayment.set(h.payment_id, t);
      }
      return byPayment;
    };

    const validTransitions = firstTransition((s) => s === "aguardando_aprovacao");
    const apprTransitions = firstTransition((s) => s === "aprovado" || s === "aprovado_em_revisao");

    const computeAvg = (transitions: Map<string, number>, fallbackField: "validated_at" | "approved_at") => {
      const samples: number[] = [];
      for (const p of pmts) {
        const created = createdById.get(p.id)!;
        let t = transitions.get(p.id);
        if (t == null) {
          const fb = (p as any)[fallbackField] as string | null;
          if (fb) t = new Date(fb).getTime();
        }
        if (t == null) continue;
        const diff = (t - created) / 3_600_000;
        if (diff >= 0) samples.push(diff);
      }
      if (!samples.length) return { avg: null as number | null, count: 0 };
      return { avg: samples.reduce((a, b) => a + b, 0) / samples.length, count: samples.length };
    };

    const valid = computeAvg(validTransitions, "validated_at");
    const appr = computeAvg(apprTransitions, "approved_at");

    const devolucoes = observ.filter((o) => idSet.has(o.payment_id) && o.status_to === "devolvido_analista").length;
    const taxaDevolucao = pct(devolucoes, total);

    const pagos = pmts.filter((p) => p.status === "pago" || p.status === "arquivado").length;
    const rejeitados = pmts.filter((p) => p.status === "rejeitado").length;
    const taxaConclusao = pct(pagos, total);

    const myInv = seesAll || isValidador ? invs : invs.filter((iv) => idSet.has(iv.payment_id));
    const nfTotal = myInv.length;
    const nfDiv = myInv.filter((iv) => iv.status === "divergente" || (iv.ai_validation?.divergences?.length ?? 0) > 0).length;
    const nfConc = myInv.filter((iv) => iv.status === "conciliada").length;
    const taxaDivergencia = pct(nfDiv, nfTotal);

    return {
      total, valor,
      ttApprov: appr.avg, aprovadosCount: appr.count,
      ttValid: valid.avg, validadosCount: valid.count,
      devolucoes, taxaDevolucao,
      pagos, rejeitados, taxaConclusao,
      nfTotal, nfDiv, nfConc, taxaDivergencia,
      throughput: total / Math.max(days, 1),
    };
  };

  const metrics = useMemo(() => computeMetrics(myPayments, obs, history, invoices, range), [myPayments, obs, history, invoices, range, seesAll, isValidador]);
  const metricsPrev = useMemo(() => computeMetrics(myPaymentsPrev, obsPrev, historyPrev, invoicesPrev, range), [myPaymentsPrev, obsPrev, historyPrev, invoicesPrev, range, seesAll, isValidador]);

  // Bottleneck
  const bottleneck = useMemo(() => {
    if (!myPayments.length) return null;
    const buckets = stageBuckets;
    let best: { label: string; count: number } | null = null;
    for (const b of buckets) {
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
            <KpiGroup title="Volume">
              <KpiCard icon={Activity} label="Bases criadas" value={String(metrics.total)} hint={formatCurrency(metrics.valor)}
                delta={deltaPct(metrics.total, metricsPrev.total)} higherIsBetter />
              <KpiCard icon={TrendingUp} label="Throughput" value={`${metrics.throughput.toFixed(1)}/dia`} hint={`média em ${range} dias`} tone="info"
                delta={deltaPct(metrics.throughput, metricsPrev.throughput)} higherIsBetter />
            </KpiGroup>

            <KpiGroup title="Velocidade">
              <KpiCard icon={Clock} label="Tempo até validação" value={fmtHours(metrics.ttValid)} hint={`${metrics.validadosCount} validadas`} tone="info"
                delta={deltaPct(metrics.ttValid, metricsPrev.ttValid)} higherIsBetter={false} />
              <KpiCard icon={Clock} label="Tempo até aprovação" value={fmtHours(metrics.ttApprov)} hint={`${metrics.aprovadosCount} aprovadas`}
                delta={deltaPct(metrics.ttApprov, metricsPrev.ttApprov)} higherIsBetter={false} />
            </KpiGroup>

            <KpiGroup title="Qualidade">
              <KpiCard icon={RotateCcw} label="Taxa de devolução" value={pctStr(metrics.taxaDevolucao)} hint={`${metrics.devolucoes} eventos`} tone="warning"
                delta={deltaPoints(metrics.taxaDevolucao, metricsPrev.taxaDevolucao)} higherIsBetter={false} unit="pp" />
              <KpiCard icon={AlertTriangle} label="Taxa de divergência NF" value={pctStr(metrics.taxaDivergencia)} hint={`${metrics.nfDiv} divergentes`} tone="destructive"
                delta={deltaPoints(metrics.taxaDivergencia, metricsPrev.taxaDivergencia)} higherIsBetter={false} unit="pp" />
            </KpiGroup>

            <KpiGroup title="Saída">
              <KpiCard icon={CheckCircle2} label="Taxa de conclusão" value={pctStr(metrics.taxaConclusao)} hint={`${metrics.pagos} pagas / ${metrics.rejeitados} rejeitadas`} tone="success"
                delta={deltaPoints(metrics.taxaConclusao, metricsPrev.taxaConclusao)} higherIsBetter unit="pp" />
              <KpiCard icon={Receipt} label="NFs no período" value={String(metrics.nfTotal)} hint={`${metrics.nfConc} conciliadas`}
                delta={deltaPct(metrics.nfTotal, metricsPrev.nfTotal)} higherIsBetter />
            </KpiGroup>
          </div>
        )}

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Distribuição por etapa atual</CardTitle></CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-32" /> : <StageBreakdown payments={myPayments} />}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

const deltaPct = (curr: number | null, prev: number | null): number | null => {
  if (curr == null || prev == null) return null;
  if (prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
};
const deltaPoints = (curr: number | null, prev: number | null): number | null => {
  if (curr == null || prev == null) return null;
  return curr - prev;
};

const KpiGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="space-y-2">
    <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{title}</p>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">{children}</div>
  </div>
);

const KpiCard = ({
  icon: Icon, label, value, hint, tone = "muted", delta, higherIsBetter, unit = "%",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: string; hint?: string;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  delta?: number | null; higherIsBetter?: boolean; unit?: "%" | "pp";
}) => {
  const toneRing: Record<string, string> = {
    muted: "border-border", info: "border-info/30", success: "border-success/30",
    warning: "border-warning/30", destructive: "border-destructive/30",
  };
  const toneIcon: Record<string, string> = {
    muted: "text-muted-foreground", info: "text-info", success: "text-success",
    warning: "text-warning-text", destructive: "text-destructive",
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
      <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums", color)}>
        <Arrow className="h-3 w-3" />{display}
      </span>
    );
  }

  return (
    <Card className={`shadow-card ${toneRing[tone]}`}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${toneIcon[tone]}`} />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {deltaEl}
        </div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
};

const stageBuckets: { label: string; statuses: PaymentStatus[]; tone: string }[] = [
  { label: "Análise IA", statuses: ["em_analise_ia", "revisao_analista"], tone: "bg-info" },
  { label: "Validação", statuses: ["aguardando_validacao"], tone: "bg-warning" },
  { label: "Aprovação", statuses: ["aguardando_aprovacao"], tone: "bg-warning" },
  { label: "NF solicitada", statuses: ["aprovado", "pedido_nf_enviado", "aprovado_em_revisao"], tone: "bg-info" },
  { label: "NF recebida", statuses: ["nf_recebida"], tone: "bg-info" },
  { label: "NF conciliada", statuses: ["nf_conciliada"], tone: "bg-success" },
  { label: "Pago", statuses: ["pago"], tone: "bg-success" },
  { label: "Devolvido / questionado", statuses: ["devolvido_analista", "nf_questionada", "aprovado_com_ressalva"], tone: "bg-destructive" },
  { label: "Rejeitado", statuses: ["rejeitado"], tone: "bg-muted" },
];

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

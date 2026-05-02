import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatCurrency, type PaymentStatus } from "@/lib/status";
import { Activity, Clock, RotateCcw, CheckCircle2, Receipt, AlertTriangle, TrendingUp } from "lucide-react";

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
const pct = (n: number, d: number) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

const Kpis = () => {
  const { user, hasRole } = useAuth();
  const [range, setRange] = useState<Range>(30);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentLite[]>([]);
  const [obs, setObs] = useState<ObsLite[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);

  const isAdmin = hasRole("admin");
  const isDiretor = hasRole("diretor");
  const isValidador = hasRole("validador");
  const isAnalista = hasRole("analista");
  const seesAll = isAdmin || isDiretor;

  useEffect(() => {
    document.title = "KPIs | MedPay";
    const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString();
    setLoading(true);
    Promise.all([
      supabase
        .from("payments")
        .select("id,status,total_amount,created_at,updated_at,approved_at,validated_at,created_by,validated_by,approved_by")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase
        .from("payment_observations")
        .select("payment_id,status_from,status_to,created_at")
        .gte("created_at", since)
        .limit(2000),
      supabase
        .from("invoices")
        .select("id,status,payment_id,created_at,ai_validation")
        .gte("created_at", since)
        .limit(1000),
    ]).then(([p, o, i]) => {
      setPayments((p.data ?? []) as PaymentLite[]);
      setObs((o.data ?? []) as ObsLite[]);
      setInvoices((i.data ?? []) as InvoiceLite[]);
      setLoading(false);
    });
  }, [range]);

  // Filtra pelo papel do usuário (analista vê só os pagamentos que criou)
  const myPayments = useMemo(() => {
    if (seesAll) return payments;
    if (isValidador) return payments; // validador vê tudo da sua fila/agregado
    if (isAnalista && user?.id) return payments.filter((p) => p.created_by === user.id);
    return [];
  }, [payments, seesAll, isValidador, isAnalista, user?.id]);

  const metrics = useMemo(() => {
    const total = myPayments.length;
    const valor = myPayments.reduce((s, p) => s + Number(p.total_amount ?? 0), 0);

    // Tempo médio até aprovação (created_at -> approved_at)
    const aprovados = myPayments.filter((p) => !!p.approved_at);
    const ttApprov = aprovados.length
      ? aprovados.reduce((s, p) => s + (new Date(p.approved_at!).getTime() - new Date(p.created_at).getTime()), 0) /
        aprovados.length /
        3_600_000
      : null;

    // Tempo médio análise -> validação (created_at -> validated_at)
    const validados = myPayments.filter((p) => !!p.validated_at);
    const ttValid = validados.length
      ? validados.reduce((s, p) => s + (new Date(p.validated_at!).getTime() - new Date(p.created_at).getTime()), 0) /
        validados.length /
        3_600_000
      : null;

    // Devoluções (status_to devolvido_*)
    const ids = new Set(myPayments.map((p) => p.id));
    const devolucoes = obs.filter(
      (o) => ids.has(o.payment_id) && (o.status_to === "devolvido_analista" || o.status_to === "devolvido_validador")
    ).length;
    const taxaDevolucao = pct(devolucoes, total);

    // Pagamentos no estado final
    const pagos = myPayments.filter((p) => p.status === "pago").length;
    const rejeitados = myPayments.filter((p) => p.status === "rejeitado").length;
    const taxaConclusao = pct(pagos, total);

    // NFs
    const myInv = seesAll || isValidador
      ? invoices
      : invoices.filter((iv) => myPayments.some((p) => p.id === iv.payment_id));
    const nfTotal = myInv.length;
    const nfDiv = myInv.filter((iv) => iv.status === "divergente" || (iv.ai_validation?.divergences?.length ?? 0) > 0).length;
    const nfConc = myInv.filter((iv) => iv.status === "conciliada").length;
    const taxaDivergencia = pct(nfDiv, nfTotal);

    return { total, valor, ttApprov, ttValid, devolucoes, taxaDevolucao, pagos, rejeitados, taxaConclusao, nfTotal, nfDiv, nfConc, taxaDivergencia };
  }, [myPayments, obs, invoices, seesAll, isValidador]);

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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)
          ) : (
            <>
              <KpiCard icon={Activity} label="Bases criadas" value={String(metrics.total)} hint={formatCurrency(metrics.valor)} />
              <KpiCard icon={Clock} label="Tempo médio até aprovação" value={fmtHours(metrics.ttApprov)} hint={`${myPayments.filter(p => !!p.approved_at).length} aprovadas`} />
              <KpiCard icon={Clock} label="Tempo médio até validação" value={fmtHours(metrics.ttValid)} hint={`${myPayments.filter(p => !!p.validated_at).length} validadas`} tone="info" />
              <KpiCard icon={RotateCcw} label="Taxa de devolução" value={metrics.taxaDevolucao} hint={`${metrics.devolucoes} eventos`} tone="warning" />
              <KpiCard icon={CheckCircle2} label="Taxa de conclusão" value={metrics.taxaConclusao} hint={`${metrics.pagos} pagas / ${metrics.rejeitados} rejeitadas`} tone="success" />
              <KpiCard icon={Receipt} label="NFs no período" value={String(metrics.nfTotal)} hint={`${metrics.nfConc} conciliadas`} />
              <KpiCard icon={AlertTriangle} label="Taxa de divergência NF" value={metrics.taxaDivergencia} hint={`${metrics.nfDiv} divergentes`} tone="destructive" />
              <KpiCard icon={TrendingUp} label="Throughput" value={`${(metrics.total / Math.max(range, 1)).toFixed(1)}/dia`} hint={`média em ${range} dias`} tone="info" />
            </>
          )}
        </div>

        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Distribuição por etapa atual</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-32" />
            ) : (
              <StageBreakdown payments={myPayments} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

const KpiCard = ({
  icon: Icon,
  label,
  value,
  hint,
  tone = "muted",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
}) => {
  const toneRing: Record<string, string> = {
    muted: "border-border", info: "border-info/30", success: "border-success/30",
    warning: "border-warning/30", destructive: "border-destructive/30",
  };
  const toneIcon: Record<string, string> = {
    muted: "text-muted-foreground", info: "text-info", success: "text-success",
    warning: "text-warning-foreground", destructive: "text-destructive",
  };
  return (
    <Card className={`shadow-card ${toneRing[tone]}`}>
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${toneIcon[tone]}`} />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
};

const StageBreakdown = ({ payments }: { payments: PaymentLite[] }) => {
  const buckets: { label: string; statuses: PaymentStatus[]; tone: string }[] = [
    { label: "Análise IA", statuses: ["em_analise_ia", "revisao_analista"], tone: "bg-info" },
    { label: "Validação", statuses: ["aguardando_validacao"], tone: "bg-warning" },
    { label: "Aprovação", statuses: ["aguardando_aprovacao"], tone: "bg-warning" },
    { label: "NF solicitada", statuses: ["aprovado", "pedido_nf_enviado"], tone: "bg-info" },
    { label: "NF recebida", statuses: ["nf_recebida"], tone: "bg-info" },
    { label: "NF conciliada", statuses: ["nf_conciliada"], tone: "bg-success" },
    { label: "Pago", statuses: ["pago"], tone: "bg-success" },
    { label: "Devolvido / questionado", statuses: ["devolvido_analista", "devolvido_validador", "nf_questionada", "aprovado_com_ressalva"], tone: "bg-destructive" },
    { label: "Rejeitado", statuses: ["rejeitado"], tone: "bg-muted" },
  ];
  const total = payments.length || 1;
  return (
    <div className="space-y-2">
      {buckets.map((b) => {
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
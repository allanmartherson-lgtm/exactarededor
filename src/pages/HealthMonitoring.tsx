import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw,
  Zap, ArrowRight, ShieldOff, FileWarning, Cpu,
  RefreshCcw, Inbox,
  type LucideIcon,
} from "lucide-react";
import { formatCurrency } from "@/lib/status";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Primitivos inline (padrão Dashboard.tsx) ──────────────────────

type BubbleColor = "purple" | "yellow" | "teal" | "red" | "blue" | "green" | "copper";

const bubbleStyle = (color: BubbleColor): React.CSSProperties => {
  const map: Record<BubbleColor, React.CSSProperties> = {
    purple: { background: "hsl(var(--bubble-purple-bg))", color: "hsl(var(--bubble-purple-fg))" },
    yellow: { background: "hsl(var(--bubble-yellow-bg))", color: "hsl(var(--bubble-yellow-fg))" },
    teal:   { background: "hsl(var(--bubble-teal-bg))",   color: "hsl(var(--bubble-teal-fg))"   },
    red:    { background: "hsl(var(--bubble-red-bg))",    color: "hsl(var(--bubble-red-fg))"    },
    blue:   { background: "hsl(var(--bubble-blue-bg))",   color: "hsl(var(--bubble-blue-fg))"   },
    green:  { background: "hsl(var(--bubble-green-bg))",  color: "hsl(var(--bubble-green-fg))"  },
    copper: { background: "#fdf5ec", color: "#9A6B3A" },
  };
  return map[color];
};

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 mb-3">
    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" as const }}>
      {children}
    </span>
    <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
  </div>
);

const SurfaceCard = ({ children, style, className }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) => (
  <div className={className} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, ...style }}>
    {children}
  </div>
);

const SurfaceCardHeader = ({ title, icon: Icon, iconColor = "teal", rightAction, sub }: {
  title: string; icon?: LucideIcon; iconColor?: BubbleColor; rightAction?: React.ReactNode; sub?: string;
}) => (
  <div className="flex items-center justify-between gap-3" style={{ padding: "18px 22px", borderBottom: "1px solid hsl(var(--border))" }}>
    <div className="flex items-center gap-2.5 min-w-0">
      {Icon && (
        <div style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", ...bubbleStyle(iconColor) }}>
          <Icon size={14} />
        </div>
      )}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: "hsl(var(--foreground))", letterSpacing: "-0.01em" }}>{title}</h3>
        {sub && <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>{sub}</p>}
      </div>
    </div>
    {rightAction}
  </div>
);

// ── Status pill ────────────────────────────────────────────────────

type HealthStatus = "ok" | "aviso" | "critico" | "carregando";

const StatusPill = ({ status }: { status: HealthStatus }) => {
  const map: Record<HealthStatus, { label: string; style: React.CSSProperties }> = {
    ok:         { label: "OK",         style: { background: "hsl(var(--bubble-green-bg))", color: "hsl(var(--bubble-green-fg))" } },
    aviso:      { label: "Aviso",      style: { background: "hsl(var(--bubble-yellow-bg))", color: "hsl(var(--bubble-yellow-fg))" } },
    critico:    { label: "Crítico",    style: { background: "hsl(var(--bubble-red-bg))", color: "hsl(var(--bubble-red-fg))" } },
    carregando: { label: "...",        style: { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" } },
  };
  const { label, style } = map[status];
  return (
    <span style={{ ...style, borderRadius: 20, padding: "3px 10px", fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", flexShrink: 0 }}>
      {label}
    </span>
  );
};

// ── Check row ─────────────────────────────────────────────────────

const CheckRow = ({ icon: Icon, iconColor, label, sub, status, action }: {
  icon: LucideIcon; iconColor: BubbleColor; label: string; sub: string;
  status: HealthStatus; action?: React.ReactNode;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", borderBottom: "1px solid hsl(var(--border))" }}>
    <div style={{ width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...bubbleStyle(iconColor) }}>
      <Icon size={15} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))" }}>{label}</div>
      <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{sub}</div>
    </div>
    {action}
    <StatusPill status={status} />
  </div>
);

// ── Tipos dos checks ───────────────────────────────────────────────

interface HealthData {
  travados: { id: string; reference: string; horasParado: number }[];
  semExpected: number;
  timeoutOcorrido: number;
  emAnaliseIA: number;
  maisAntigo: string | null;
  regrasSemMatch: { id: string; name: string; diasSemMatch: number }[];
  alertasNaoResolvidos: number;
  valorEmRisco: number;
}

interface FailedJob {
  jobId: string;
  paymentId: string;
  paymentReference: string;
  status: string;
  failedCompanies: Array<{ company_name: string; error: string; at: string }>;
  finishedAt: string | null;
  createdAt: string;
}

const TRAVADO_HORAS = 3;
const FILA_CRITICA = 10;
const FILA_AVISO = 5;

function horasAtras(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function fmtHoras(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}min`;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${Math.floor(h / 24)}d ${Math.round(h % 24)}h`;
}

export default function HealthMonitoring() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cutoff = new Date(Date.now() - TRAVADO_HORAS * 3_600_000).toISOString();
      const { data: travadosRaw } = await supabase
        .from("payments")
        .select("id, reference, updated_at")
        .eq("status", "em_analise_ia")
        .lt("updated_at", cutoff)
        .order("updated_at", { ascending: true })
        .limit(10);

      const travados = (travadosRaw ?? []).map((p: any) => ({
        id: p.id,
        reference: p.reference,
        horasParado: horasAtras(p.updated_at),
      }));

      const { count: semExpected } = await supabase
        .from("payment_items")
        .select("id", { count: "exact", head: true })
        .is("expected_amount", null)
        .not("ai_status", "eq", "pendente");

      const { count: timeoutOcorrido } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("processing_timeout_occurred", true)
        .not("status", "in", '("cancelado","pago","lancado")');

      const { data: filaRaw, count: emAnaliseIA } = await supabase
        .from("payments")
        .select("created_at", { count: "exact" })
        .eq("status", "em_analise_ia")
        .order("created_at", { ascending: true })
        .limit(1);

      const maisAntigo = (filaRaw ?? [])[0]?.created_at ?? null;

      const since30 = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();
      const { data: rulesRaw } = await supabase
        .from("rules")
        .select("id, name, updated_at")
        .eq("active", true);

      const { data: matchedRules } = await supabase
        .from("payment_items")
        .select("ai_findings")
        .gte("created_at", since30)
        .not("ai_findings", "is", null)
        .limit(2000);

      const matchedNames = new Set<string>();
      for (const it of matchedRules ?? []) {
        const findings = (it as any).ai_findings;
        if (Array.isArray(findings?.matched_rules)) {
          findings.matched_rules.forEach((n: string) => matchedNames.add(n));
        }
      }

      const regrasSemMatch = (rulesRaw ?? [])
        .filter((r: any) => !matchedNames.has(r.name))
        .map((r: any) => ({
          id: r.id,
          name: r.name,
          diasSemMatch: Math.floor(horasAtras(r.updated_at) / 24),
        }))
        .slice(0, 10);

      const { data: alertItems } = await supabase
        .from("payment_items")
        .select("gross_amount, validation_findings")
        .not("validation_findings", "is", null)
        .neq("validation_findings", "[]")
        .limit(2000);

      let alertasNaoResolvidos = 0;
      let valorEmRisco = 0;
      for (const it of alertItems ?? []) {
        const findings = (it as any).validation_findings;
        if (!Array.isArray(findings) || findings.length === 0) continue;
        alertasNaoResolvidos += findings.length;
        valorEmRisco += Number((it as any).gross_amount ?? 0);
      }

      setData({
        travados,
        semExpected: semExpected ?? 0,
        timeoutOcorrido: timeoutOcorrido ?? 0,
        emAnaliseIA: emAnaliseIA ?? 0,
        maisAntigo,
        regrasSemMatch,
        alertasNaoResolvidos,
        valorEmRisco,
      });

      // 7. Dead-letter queue — jobs com empresas que falharam
      const { data: failedJobsRaw } = await supabase
        .from("payment_processing_jobs")
        .select("id, payment_id, status, failed_companies, finished_at, created_at, payments(reference)")
        .not("failed_companies", "is", null)
        .neq("failed_companies", "[]")
        .in("status", ["parcial", "em_andamento", "concluido"])
        .order("created_at", { ascending: false })
        .limit(20);

      // Agrupa por payment_id — mantém só o job mais recente por lote
      const byPayment = new Map<string, FailedJob>();
      for (const job of failedJobsRaw ?? []) {
        const ref = (job as any).payments?.reference ?? job.payment_id.slice(0, 8);
        const companies = Array.isArray(job.failed_companies) ? job.failed_companies : [];
        if (companies.length === 0) continue;
        if (!byPayment.has(job.payment_id)) {
          byPayment.set(job.payment_id, {
            jobId: job.id,
            paymentId: job.payment_id,
            paymentReference: ref,
            status: job.status,
            failedCompanies: companies as any,
            finishedAt: job.finished_at,
            createdAt: job.created_at,
          });
        }
      }
      setFailedJobs(Array.from(byPayment.values()));

    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    document.title = "Saúde do Motor | MedPay";
    load();
    const interval = setInterval(load, 5 * 60_000);
    return () => clearInterval(interval);
  }, [load]);

  const globalStatus: HealthStatus = !data ? "carregando"
    : data.travados.length > 0 || data.timeoutOcorrido > 0 ? "critico"
    : data.emAnaliseIA >= FILA_CRITICA || (data.semExpected ?? 0) > 20 ? "aviso"
    : "ok";

  const motorStatus: HealthStatus = !data ? "carregando"
    : data.travados.length > 0 ? "critico"
    : data.timeoutOcorrido > 0 || (data.semExpected ?? 0) > 5 ? "aviso"
    : "ok";

  const filaStatus: HealthStatus = !data ? "carregando"
    : (data.emAnaliseIA ?? 0) >= FILA_CRITICA ? "critico"
    : (data.emAnaliseIA ?? 0) >= FILA_AVISO ? "aviso"
    : "ok";

  const regraStatus: HealthStatus = !data ? "carregando"
    : data.regrasSemMatch.length > 5 ? "aviso"
    : "ok";

  const validacaoStatus: HealthStatus = !data ? "carregando"
    : data.alertasNaoResolvidos > 50 ? "critico"
    : data.alertasNaoResolvidos > 10 ? "aviso"
    : "ok";

  const retryCompanies = async (paymentId: string, companies: string[], jobKey: string) => {
    setRetrying(prev => ({ ...prev, [jobKey]: true }));
    try {
      const { data, error } = await supabase.functions.invoke("dispatch-payment-analysis", {
        body: {
          payment_id: paymentId,
          only_companies: companies,
        },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; message?: string; total_companies?: number };
      if (!result?.ok && result?.total_companies === 0) {
        toast.warning("Empresas sem retry disponível", {
          description: result?.message ?? "Verifique se os grupos ainda estão em revisão do analista.",
        });
      } else {
        toast.success(`Retry iniciado para ${companies.length} empresa(s)`, {
          description: "As empresas serão reanalisadas pelo motor. Acompanhe pelo lote.",
        });
        // Aguarda 3s e recarrega
        setTimeout(() => load(), 3000);
      }
    } catch (e: any) {
      toast.error("Falha ao iniciar retry", {
        description: e?.message ?? String(e),
      });
    } finally {
      setRetrying(prev => ({ ...prev, [jobKey]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", lineHeight: 1.2 }}>
            Saúde do <span style={{ fontWeight: 700 }}>Motor</span>
          </h1>
          <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            Monitoramento operacional do motor MedPay · Atualizado às {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusPill status={globalStatus} />
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
              borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 600,
              color: "hsl(var(--foreground))", cursor: loading ? "not-allowed" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
            {loading ? "Verificando..." : "Atualizar"}
          </button>
        </div>
      </div>

      {globalStatus === "critico" && (
        <div style={{ background: "hsl(var(--bubble-red-bg))", border: "1px solid hsl(var(--bubble-red-fg) / 0.4)", borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <AlertTriangle size={18} style={{ color: "hsl(var(--bubble-red-fg))", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--bubble-red-fg))" }}>Atenção imediata necessária</div>
            <div style={{ fontSize: 12, color: "hsl(var(--bubble-red-fg))", opacity: 0.8, marginTop: 2 }}>
              {data?.travados.length ? `${data.travados.length} lote(s) travado(s) há mais de ${TRAVADO_HORAS}h. ` : ""}
              {data?.timeoutOcorrido ? `${data.timeoutOcorrido} lote(s) com timeout de análise. ` : ""}
            </div>
          </div>
        </div>
      )}
      {globalStatus === "ok" && !loading && (
        <div style={{ background: "hsl(var(--bubble-green-bg))", border: "1px solid hsl(var(--bubble-green-fg) / 0.4)", borderRadius: 10, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12 }}>
          <CheckCircle2 size={18} style={{ color: "hsl(var(--bubble-green-fg))", flexShrink: 0 }} />
          <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--bubble-green-fg))" }}>
            Todos os sistemas operando normalmente.
          </div>
        </div>
      )}

      <section>
        <SectionLabel>Motor de análise</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Engine de Regras e IA"
            icon={Cpu}
            iconColor="blue"
            sub="Verifica lotes travados, timeouts e itens sem cálculo"
            rightAction={<StatusPill status={motorStatus} />}
          />

          <CheckRow
            icon={Clock}
            iconColor={data?.travados.length ? "red" : "green"}
            label="Lotes travados em análise IA"
            sub={
              !data ? "Verificando..."
              : data.travados.length === 0 ? `Nenhum lote parado há mais de ${TRAVADO_HORAS}h`
              : `${data.travados.length} lote(s) sem atualização há mais de ${TRAVADO_HORAS}h`
            }
            status={!data ? "carregando" : data.travados.length > 0 ? "critico" : "ok"}
            action={
              data?.travados.length ? (
                <Link to="/pagamentos?status=em_analise_ia" style={{ fontSize: 11, color: "#9A6B3A", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Ver lotes <ArrowRight size={11} />
                </Link>
              ) : undefined
            }
          />

          <CheckRow
            icon={Zap}
            iconColor={data?.timeoutOcorrido ? "yellow" : "green"}
            label="Lotes com timeout de análise"
            sub={
              !data ? "Verificando..."
              : data.timeoutOcorrido === 0 ? "Nenhum lote com timeout ativo"
              : `${data.timeoutOcorrido} lote(s) com análise incompleta por timeout`
            }
            status={!data ? "carregando" : data.timeoutOcorrido > 0 ? "aviso" : "ok"}
            action={
              data?.timeoutOcorrido ? (
                <Link to="/pagamentos" style={{ fontSize: 11, color: "#9A6B3A", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Ver lotes <ArrowRight size={11} />
                </Link>
              ) : undefined
            }
          />

          <div style={{ borderBottom: "none" }}>
            <CheckRow
              icon={FileWarning}
              iconColor={(data?.semExpected ?? 0) > 20 ? "yellow" : "green"}
              label="Itens sem valor esperado calculado"
              sub={
                !data ? "Verificando..."
                : data.semExpected === 0 ? "Todos os itens analisados têm valor esperado"
                : `${data.semExpected} item(ns) sem expected_amount — possível falha silenciosa do engine`
              }
              status={!data ? "carregando" : (data.semExpected ?? 0) > 20 ? "aviso" : "ok"}
            />
          </div>

          {data?.travados.length ? (
            <div style={{ margin: "0 22px 16px", background: "hsl(var(--bubble-red-bg))", borderRadius: 8, overflow: "hidden", border: "1px solid hsl(var(--bubble-red-fg) / 0.2)" }}>
              {data.travados.map((t, i) => (
                <Link key={t.id} to={`/pagamentos/${t.id}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: i < data.travados.length - 1 ? "1px solid hsl(var(--bubble-red-fg) / 0.15)" : "none", textDecoration: "none", color: "inherit" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))" }}>{t.reference}</div>
                    <div style={{ fontSize: 11, color: "hsl(var(--bubble-red-fg))", marginTop: 1 }}>Parado há {fmtHoras(t.horasParado)}</div>
                  </div>
                  <ArrowRight size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
                </Link>
              ))}
            </div>
          ) : null}
        </SurfaceCard>
      </section>

      <section>
        <SectionLabel>Fila de processamento</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Fila de Análise"
            icon={Activity}
            iconColor="purple"
            sub="Lotes aguardando processamento pelo motor"
            rightAction={<StatusPill status={filaStatus} />}
          />
          <CheckRow
            icon={Clock}
            iconColor={filaStatus === "critico" ? "red" : filaStatus === "aviso" ? "yellow" : "green"}
            label="Lotes em análise IA agora"
            sub={
              !data ? "Verificando..."
              : data.emAnaliseIA === 0 ? "Fila vazia — nenhum lote aguardando processamento"
              : data.maisAntigo
                ? `${data.emAnaliseIA} lote(s) na fila · mais antigo: ${fmtHoras(horasAtras(data.maisAntigo))} atrás`
                : `${data.emAnaliseIA} lote(s) na fila`
            }
            status={filaStatus}
            action={
              (data?.emAnaliseIA ?? 0) > 0 ? (
                <Link to="/pagamentos?status=em_analise_ia" style={{ fontSize: 11, color: "#9A6B3A", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Ver fila <ArrowRight size={11} />
                </Link>
              ) : undefined
            }
          />
        </SurfaceCard>
      </section>

      <section>
        <SectionLabel>Saúde das regras</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Regras sem match recente"
            icon={ShieldOff}
            iconColor="yellow"
            sub="Regras ativas que não foram aplicadas em nenhum item nos últimos 30 dias"
            rightAction={<StatusPill status={regraStatus} />}
          />
          {!data ? (
            <div style={{ padding: "22px", display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 20, background: "hsl(var(--muted))", borderRadius: 4, opacity: 0.3 }} />)}
            </div>
          ) : data.regrasSemMatch.length === 0 ? (
            <div style={{ padding: "22px", display: "flex", alignItems: "center", gap: 10 }}>
              <CheckCircle2 size={16} style={{ color: "hsl(var(--bubble-green-fg))" }} />
              <span style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>Todas as regras ativas tiveram match nos últimos 30 dias.</span>
            </div>
          ) : (
            <div>
              {data.regrasSemMatch.map((r, i) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 22px", borderBottom: i < data.regrasSemMatch.length - 1 ? "1px solid hsl(var(--border))" : "none" }}>
                  <AlertTriangle size={14} style={{ color: "hsl(var(--bubble-yellow-fg))", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>Sem match nos últimos 30 dias</div>
                  </div>
                  <Link to={`/regras/pagamento`} style={{ fontSize: 11, color: "#9A6B3A", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Ver regra <ArrowRight size={11} />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </SurfaceCard>
      </section>

      <section>
        <SectionLabel>Alertas de validação assistencial</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Alertas não resolvidos"
            icon={AlertTriangle}
            iconColor={validacaoStatus === "critico" ? "red" : validacaoStatus === "aviso" ? "yellow" : "teal"}
            sub="Itens com alertas de validação assistencial ainda sem resolução"
            rightAction={<StatusPill status={validacaoStatus} />}
          />
          <div style={{ padding: "18px 22px", display: "flex", gap: 32, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" as const }}>Alertas ativos</div>
              <div style={{ fontSize: 32, fontWeight: 300, letterSpacing: "-0.03em", color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>
                {data ? data.alertasNaoResolvidos : "—"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" as const }}>Valor em risco</div>
              <div style={{ fontSize: 32, fontWeight: 300, letterSpacing: "-0.03em", color: "#9A6B3A", fontVariantNumeric: "tabular-nums", marginTop: 4 }}>
                {data ? formatCurrency(data.valorEmRisco) : "—"}
              </div>
            </div>
          </div>
          <div style={{ padding: "0 22px 18px" }}>
            <Link to="/regras/validacao" style={{ fontSize: 12, color: "#9A6B3A", fontWeight: 600, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              Gerenciar regras de validação <ArrowRight size={13} />
            </Link>
          </div>
        </SurfaceCard>
      </section>

      {/* ── Seção: Dead-Letter Queue ── */}
      <section>
        <SectionLabel>Dead-letter queue</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Empresas com falha de processamento"
            icon={Inbox}
            iconColor="red"
            sub="Empresas que falharam em jobs anteriores e precisam de retry manual"
            rightAction={
              <StatusPill status={
                !data ? "carregando"
                : failedJobs.length === 0 ? "ok"
                : failedJobs.some(j => j.failedCompanies.length > 3) ? "critico"
                : "aviso"
              } />
            }
          />

          {loading ? (
            <div style={{ padding: "22px", display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3].map(i => <div key={i} style={{ height: 24, background: "hsl(var(--muted))", borderRadius: 4, opacity: 0.3 }} />)}
            </div>
          ) : failedJobs.length === 0 ? (
            <div style={{ padding: "22px", display: "flex", alignItems: "center", gap: 10 }}>
              <CheckCircle2 size={16} style={{ color: "hsl(var(--bubble-green-fg))" }} />
              <span style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
                Nenhuma empresa com falha pendente de retry.
              </span>
            </div>
          ) : (
            <div>
              {failedJobs.map((job, ji) => {
                const jobKey = job.jobId;
                const isRetrying = retrying[jobKey];
                const allCompanyNames = job.failedCompanies.map(f => f.company_name);
                // Agrupa erros por tipo para exibição compacta
                const errorGroups = job.failedCompanies.reduce((acc, f) => {
                  const type = f.error.includes("504") || f.error.includes("IDLE_TIMEOUT") ? "timeout"
                    : f.error.includes("500") ? "erro_motor"
                    : "outro";
                  acc[type] = (acc[type] ?? 0) + 1;
                  return acc;
                }, {} as Record<string, number>);

                return (
                  <div key={job.jobId} style={{
                    borderBottom: ji < failedJobs.length - 1 ? "1px solid hsl(var(--border))" : "none",
                  }}>
                    {/* Header do job */}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", background: "hsl(var(--muted) / 0.3)" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Link
                            to={`/pagamentos/${job.paymentId}`}
                            style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))", textDecoration: "none" }}
                          >
                            {job.paymentReference}
                          </Link>
                          <span style={{
                            background: "hsl(var(--bubble-red-bg))", color: "hsl(var(--bubble-red-fg))",
                            borderRadius: 20, padding: "2px 8px", fontSize: 10, fontWeight: 700,
                            textTransform: "uppercase" as const, letterSpacing: "0.05em",
                          }}>
                            {job.failedCompanies.length} empresa{job.failedCompanies.length !== 1 ? "s" : ""} com falha
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 3, display: "flex", gap: 12 }}>
                          {errorGroups.timeout ? <span>⏱ {errorGroups.timeout} timeout</span> : null}
                          {errorGroups.erro_motor ? <span>⚡ {errorGroups.erro_motor} erro do motor</span> : null}
                          {errorGroups.outro ? <span>❓ {errorGroups.outro} outros</span> : null}
                          <span>· {new Date(job.createdAt).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => retryCompanies(job.paymentId, allCompanyNames, jobKey)}
                        disabled={isRetrying}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          background: isRetrying ? "hsl(var(--muted))" : "#9A6B3A",
                          color: isRetrying ? "hsl(var(--muted-foreground))" : "white",
                          border: "none", borderRadius: 8, padding: "7px 14px",
                          fontSize: 12, fontWeight: 600, cursor: isRetrying ? "not-allowed" : "pointer",
                          opacity: isRetrying ? 0.7 : 1, transition: "all 0.15s",
                          flexShrink: 0,
                        }}
                      >
                        <RefreshCcw size={13} style={{ animation: isRetrying ? "spin 1s linear infinite" : "none" }} />
                        {isRetrying ? "Iniciando..." : `Retry (${allCompanyNames.length})`}
                      </button>
                    </div>

                    {/* Lista de empresas com falha */}
                    {job.failedCompanies.map((f, fi) => {
                      const isTimeout = f.error.includes("504") || f.error.includes("IDLE_TIMEOUT");
                      const isMotorError = f.error.includes("500");
                      const errorColor = isTimeout
                        ? "hsl(var(--bubble-yellow-fg))"
                        : isMotorError ? "hsl(var(--bubble-red-fg))"
                        : "hsl(var(--muted-foreground))";
                      const errorLabel = isTimeout ? "Timeout (150s)" : isMotorError ? "Erro motor" : "Falha";
                      return (
                        <div key={fi} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "9px 22px 9px 36px",
                          borderTop: "1px solid hsl(var(--border) / 0.5)",
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.company_name}
                            </div>
                            <div style={{ fontSize: 10, color: "hsl(var(--muted-foreground))", marginTop: 1 }}>
                              {new Date(f.at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>
                          <span style={{ fontSize: 10, color: errorColor, fontWeight: 600, flexShrink: 0 }}>
                            {errorLabel}
                          </span>
                          <button
                            onClick={() => retryCompanies(job.paymentId, [f.company_name], `${jobKey}-${fi}`)}
                            disabled={retrying[`${jobKey}-${fi}`]}
                            style={{
                              display: "inline-flex", alignItems: "center", gap: 4,
                              background: "transparent", border: "1px solid hsl(var(--border))",
                              borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 600,
                              color: "#9A6B3A", cursor: "pointer", flexShrink: 0,
                            }}
                          >
                            <RefreshCcw size={10} />
                            Retry
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </section>
    </div>
  );
}

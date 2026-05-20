import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";
import { Link } from "react-router-dom";
import {
  TrendingUp, ShieldAlert, Clock, Building2,
  BarChart3, ArrowRight, FileText, CheckCircle,
  type LucideIcon,
} from "lucide-react";

// --- Primitivos inline (mesmo padrão do Dashboard.tsx) ---

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

const SurfaceCard = ({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
  <div className={className} style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, ...style }}>
    {children}
  </div>
);

const SurfaceCardHeader = ({ title, icon: Icon, iconColor = "teal", rightAction }: {
  title: string; icon?: LucideIcon; iconColor?: BubbleColor; rightAction?: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-3" style={{ padding: "18px 22px", borderBottom: "1px solid hsl(var(--border))" }}>
    <div className="flex items-center gap-2.5 min-w-0">
      {Icon && (
        <div style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", ...bubbleStyle(iconColor) }}>
          <Icon size={14} />
        </div>
      )}
      <h3 style={{ fontSize: 14, fontWeight: 600, color: "hsl(var(--foreground))", letterSpacing: "-0.01em" }}>{title}</h3>
    </div>
    {rightAction}
  </div>
);

interface ExecKpiCardProps {
  label: string; value: string; sub: string;
  icon: LucideIcon;
  color: BubbleColor; badge?: string; badgeColor?: string; delta?: number;
}

const ExecKpiCard = ({ label, value, sub, icon: Icon, color, badge, badgeColor, delta }: ExecKpiCardProps) => (
  <div style={{
    background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12,
    padding: "22px", display: "flex", flexDirection: "column", gap: 14, position: "relative",
    overflow: "hidden", minWidth: 0,
  }}>
    <div className="flex items-start justify-between gap-3">
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" as const, lineHeight: 1.4 }}>{label}</span>
      <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...bubbleStyle(color) }}>
        <Icon size={18} strokeWidth={2} />
      </div>
    </div>
    <div style={{ fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em", lineHeight: 1, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>{sub}</div>
    {badge && (
      <span style={{ background: badgeColor || "hsl(var(--muted))", borderRadius: 20, padding: "3px 10px", fontSize: 10, fontWeight: 700, alignSelf: "flex-start", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>{badge}</span>
    )}
    {delta !== undefined && (
      <span style={{ position: "absolute", top: 14, right: 14, fontSize: 11, fontWeight: 600, color: delta >= 0 ? "hsl(var(--bubble-green-fg))" : "hsl(var(--bubble-red-fg))" }}>
        {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%
      </span>
    )}
  </div>
);

export default function ExecutiveDashboard() {
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<any[]>([]);
  const [validationImpact, setValidationImpact] = useState<{ alertas: number; valor: number; byRule: Map<string, { alertas: number; valor: number }> }>({ alertas: 0, valor: 0, byRule: new Map() });
  const [monthlyCompetencia, setMonthlyCompetencia] = useState<{ month: string; valor: number }[]>([]);
  const [monthlyProcessamento, setMonthlyProcessamento] = useState<{ month: string; valor: number }[]>([]);
  const [topEmpresas, setTopEmpresas] = useState<{ name: string; valor: number }[]>([]);
  const [chartMode, setChartMode] = useState<"competencia" | "processamento">("competencia");

  useEffect(() => {
    document.title = "Dashboard Executivo | MedPay";
    (async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 12);
      const { data: pays } = await supabase
        .from("payments")
        .select("id, reference, status, total_amount, items_count, competence_month, created_at")
        .gte("created_at", since.toISOString())
        .not("status", "in", '("cancelado","rascunho")')
        .order("created_at", { ascending: false });
      setPayments(pays ?? []);

      const byCompetencia: Record<string, number> = {};
      (pays ?? []).forEach((p: any) => {
        const m = (p.competence_month ?? "").slice(0, 7);
        if (m) byCompetencia[m] = (byCompetencia[m] ?? 0) + Number(p.total_amount ?? 0);
      });
      setMonthlyCompetencia(
        Object.entries(byCompetencia).sort(([a], [b]) => a.localeCompare(b)).slice(-7)
          .map(([month, valor]) => ({ month, valor }))
      );

      const byProcessamento: Record<string, number> = {};
      (pays ?? []).forEach((p: any) => {
        const m = (p.created_at ?? "").slice(0, 7);
        if (m) byProcessamento[m] = (byProcessamento[m] ?? 0) + Number(p.total_amount ?? 0);
      });
      setMonthlyProcessamento(
        Object.entries(byProcessamento).sort(([a], [b]) => a.localeCompare(b)).slice(-7)
          .map(([month, valor]) => ({ month, valor }))
      );

      const { data: items } = await supabase
        .from("payment_items")
        .select("gross_amount, validation_findings")
        .not("validation_findings", "is", null)
        .neq("validation_findings", "[]");

      const byRule = new Map<string, { alertas: number; valor: number }>();
      let totalAlertas = 0, totalValor = 0;
      for (const it of items ?? []) {
        const findings = it.validation_findings as any[];
        if (!Array.isArray(findings)) continue;
        for (const f of findings) {
          if (!f.rule_name) continue;
          const cur = byRule.get(f.rule_name) ?? { alertas: 0, valor: 0 };
          cur.alertas += 1;
          cur.valor += Number(it.gross_amount ?? 0);
          byRule.set(f.rule_name, cur);
          totalAlertas++;
          totalValor += Number(it.gross_amount ?? 0);
        }
      }
      setValidationImpact({ alertas: totalAlertas, valor: totalValor, byRule });
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    supabase.from("payment_company_groups")
      .select("company_name, total_amount")
      .order("total_amount", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        const map = new Map<string, number>();
        (data ?? []).forEach((g: any) => {
          map.set(g.company_name, (map.get(g.company_name) ?? 0) + Number(g.total_amount ?? 0));
        });
        setTopEmpresas(Array.from(map.entries()).map(([name, valor]) => ({ name, valor })).sort((a, b) => b.valor - a.valor).slice(0, 5));
      });
  }, []);

  const totalVolume = useMemo(() => payments.reduce((a, p) => a + Number(p.total_amount ?? 0), 0), [payments]);
  const totalItems = useMemo(() => payments.reduce((a, p) => a + Number(p.items_count ?? 0), 0), [payments]);
  const aprovados = useMemo(() => payments.filter(p =>
    !["em_analise_ia","revisao_analista","aguardando_validacao","aguardando_aprovacao","rascunho","cancelado","devolvido_analista"].includes(p.status)
  ).length, [payments]);
  const emAnalise = useMemo(() => payments.filter(p => ["em_analise_ia","revisao_analista","aguardando_validacao","aguardando_aprovacao"].includes(p.status)).length, [payments]);

  const monthlyData = useMemo(
    () => chartMode === "competencia" ? monthlyCompetencia : monthlyProcessamento,
    [chartMode, monthlyCompetencia, monthlyProcessamento]
  );


  const MiniBarChart = () => {
    if (monthlyData.length === 0) return null;
    const max = Math.max(...monthlyData.map(d => d.valor), 1);
    const fmtMonth = (m: string) => {
      const parts = m.split("-");
      const year = parts[0]?.slice(2) ?? "";
      const mo = parseInt(parts[1] ?? "1");
      const months = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
      return `${months[mo - 1] ?? m}/${year}`;
    };
    const fmtShort = (v: number) => {
      if (v >= 1000000) return `R$ ${(v/1000000).toFixed(1)}M`;
      if (v >= 1000) return `R$ ${(v/1000).toFixed(0)}k`;
      return formatCurrency(v);
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {monthlyData.map((d, i) => {
          const isLast = i === monthlyData.length - 1;
          const pct = Math.max(4, (d.valor / max) * 100);
          return (
            <div key={d.month} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 44, fontSize: 10, color: isLast ? "#9A6B3A" : "hsl(var(--muted-foreground))", fontWeight: isLast ? 700 : 400, flexShrink: 0, textAlign: "right" }}>
                {fmtMonth(d.month)}
              </span>
              <div style={{ flex: 1, background: "hsl(var(--muted))", borderRadius: 4, height: 18, overflow: "hidden" }}>
                <div style={{
                  width: `${pct}%`, height: "100%", borderRadius: 4,
                  background: isLast ? "#9A6B3A" : "hsl(var(--bubble-purple-bg))",
                  display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 6,
                  transition: "width 0.3s ease",
                }}>
                  {pct > 25 && (
                    <span style={{ fontSize: 10, color: isLast ? "white" : "hsl(var(--bubble-purple-fg))", fontWeight: 600 }}>
                      {fmtShort(d.valor)}
                    </span>
                  )}
                </div>
              </div>
              <span style={{ width: 80, fontSize: 11, color: isLast ? "#9A6B3A" : "hsl(var(--foreground))", fontWeight: isLast ? 700 : 400, flexShrink: 0, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                {fmtShort(d.valor)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };


  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", lineHeight: 1.2 }}>
          Dashboard <span style={{ fontWeight: 700 }}>Executivo</span>
        </h1>
        <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
          DF Star · Visão consolidada de pagamentos médicos · {new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
        </p>
      </div>

      <section>
        <SectionLabel>Visão geral</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 14 }}>
          <ExecKpiCard label="Volume Total" value={formatCurrency(totalVolume)} sub={`${totalItems} itens · ${payments.length} lotes`} icon={TrendingUp} color="copper" />
          <ExecKpiCard label="Lotes Aprovados" value={String(aprovados)} sub={`${payments.length > 0 ? ((aprovados / payments.length) * 100).toFixed(0) : 0}% do total processado`} icon={CheckCircle} color="green" badge="Concluídos" badgeColor="hsl(var(--bubble-green-bg))" />
          <ExecKpiCard label="Em Risco — Validação" value={formatCurrency(validationImpact.valor)} sub={`${validationImpact.alertas} alertas ativos`} icon={ShieldAlert} color="red" badge="Requer revisão" badgeColor="hsl(var(--bubble-red-bg))" />
          <ExecKpiCard label="Lotes em Andamento" value={String(emAnalise)} sub="em análise, validação ou aprovação" icon={Clock} color="blue" />
        </div>
      </section>

      <section>
        <SectionLabel>Análise detalhada</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 14 }}>
          <SurfaceCard style={{ gridColumn: "span 2" }}>
            <SurfaceCardHeader
              title="Evolução Mensal — Volume Processado"
              icon={BarChart3}
              iconColor="copper"
              rightAction={
                <div
                  role="radiogroup"
                  aria-label="Modo do gráfico"
                  style={{ display: "inline-flex", background: "hsl(var(--muted))", borderRadius: 8, padding: 3, gap: 2 }}
                >
                  {(["competencia", "processamento"] as const).map((mode) => {
                    const active = chartMode === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setChartMode(mode)}
                        style={{
                          padding: "5px 11px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                          border: "none", cursor: "pointer", transition: "all 0.15s ease",
                          background: active ? "hsl(var(--primary))" : "transparent",
                          color: active ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {mode === "competencia" ? "Competência" : "Processamento"}
                      </button>
                    );
                  })}
                </div>
              }
            />
            <div style={{ padding: "22px" }}>
              {loading ? (
                <div style={{ height: 80, background: "hsl(var(--muted))", borderRadius: 8, opacity: 0.4 }} />
              ) : monthlyData.length === 0 ? (
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "24px 0" }}>Sem dados suficientes.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <MiniBarChart />
                </div>
              )}
            </div>
          </SurfaceCard>

          <SurfaceCard>
            <SurfaceCardHeader title="Top Empresas" icon={Building2} iconColor="teal" />
            <div>
              {loading ? (
                <div style={{ padding: "22px" }}>
                  {[1,2,3].map(i => <div key={i} style={{ height: 20, background: "hsl(var(--muted))", borderRadius: 4, marginBottom: 12, opacity: 0.3 }} />)}
                </div>
              ) : topEmpresas.length === 0 ? (
                <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))", textAlign: "center", padding: "24px" }}>Sem dados.</p>
              ) : (
                <div>
                  {topEmpresas.map((e, i) => {
                    const maxValor = topEmpresas[0]?.valor ?? 1;
                    const pct = Math.max(8, (e.valor / maxValor) * 100);
                    return (
                      <div key={e.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 22px", borderBottom: i < topEmpresas.length - 1 ? "1px solid hsl(var(--border))" : "none" }}>
                        <span style={{ width: 20, height: 20, background: "hsl(var(--muted))", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", flexShrink: 0 }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                          <div style={{ height: 3, background: "hsl(var(--muted))", borderRadius: 2, marginTop: 4 }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: "#9A6B3A", borderRadius: 2, opacity: 0.5 + i * 0.1 }} />
                          </div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{formatCurrency(e.valor)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </SurfaceCard>
        </div>
      </section>

      {validationImpact.byRule.size > 0 && (
        <section>
          <SectionLabel>Alertas assistenciais</SectionLabel>
          <SurfaceCard>
            <SurfaceCardHeader
              title="Impacto financeiro por regra de validação"
              icon={ShieldAlert}
              iconColor="yellow"
              rightAction={
                <Link to="/regras/validacao" style={{ fontSize: 12, color: "#9A6B3A", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  Gerenciar regras <ArrowRight size={13} />
                </Link>
              }
            />
            <div>
              {Array.from(validationImpact.byRule.entries()).map(([name, data], i, arr) => (
                <div key={name} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "14px 22px",
                  borderBottom: i < arr.length - 1 ? "1px solid hsl(var(--border))" : "none",
                  background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.3)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))" }}>{name}</div>
                    <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>{data.alertas} alerta{data.alertas !== 1 ? "s" : ""} detectado{data.alertas !== 1 ? "s" : ""}</div>
                  </div>
                  <div style={{ background: "hsl(var(--bubble-yellow-bg))", border: "1px solid hsl(var(--bubble-yellow-fg) / 0.3)", borderRadius: 8, padding: "4px 12px", fontSize: 13, fontWeight: 700, color: "hsl(var(--bubble-yellow-fg))", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {formatCurrency(data.valor)}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", background: "#fdf5ec", borderTop: "1px solid hsl(var(--border))", borderRadius: "0 0 12px 12px" }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#9A6B3A" }}>Total em risco — {validationImpact.alertas} alertas</span>
                <span style={{ fontSize: 18, fontWeight: 600, color: "#9A6B3A", fontVariantNumeric: "tabular-nums" }}>{formatCurrency(validationImpact.valor)}</span>
              </div>
            </div>
          </SurfaceCard>
        </section>
      )}

      <section>
        <SectionLabel>Lotes recentes</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Últimos lotes processados"
            icon={FileText}
            iconColor="purple"
            rightAction={
              <Link to="/pagamentos" style={{ fontSize: 12, color: "#9A6B3A", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                Ver todos <ArrowRight size={13} />
              </Link>
            }
          />
          <div>
            {loading ? (
              <div style={{ padding: 22 }}>
                {[1,2,3].map(i => <div key={i} style={{ height: 40, background: "hsl(var(--muted))", borderRadius: 6, marginBottom: 8, opacity: 0.3 }} />)}
              </div>
            ) : payments.slice(0, 6).map((p, i) => {
              const statusColors: Record<string, { bg: string; fg: string }> = {
                aprovado: { bg: "hsl(var(--bubble-green-bg))", fg: "hsl(var(--bubble-green-fg))" },
                aguardando_aprovacao: { bg: "hsl(var(--bubble-yellow-bg))", fg: "hsl(var(--bubble-yellow-fg))" },
                aguardando_validacao: { bg: "hsl(var(--bubble-blue-bg))", fg: "hsl(var(--bubble-blue-fg))" },
                revisao_analista: { bg: "hsl(var(--bubble-purple-bg))", fg: "hsl(var(--bubble-purple-fg))" },
                pago: { bg: "hsl(var(--bubble-teal-bg))", fg: "hsl(var(--bubble-teal-fg))" },
              };
              const sc = statusColors[p.status] ?? { bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" };
              return (
                <Link key={p.id} to={`/pagamentos/${p.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderBottom: i < 5 ? "1px solid hsl(var(--border))" : "none", textDecoration: "none", color: "inherit" }}
                  className="hover:bg-muted/30 transition-colors">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.reference}</div>
                    <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginTop: 2 }}>
                      {p.items_count} itens · {formatCurrency(Number(p.total_amount ?? 0))}
                    </div>
                  </div>
                  <span style={{ background: sc.bg, color: sc.fg, borderRadius: 20, padding: "3px 10px", fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.05em", flexShrink: 0 }}>
                    {p.status.replace(/_/g, " ")}
                  </span>
                </Link>
              );
            })}
          </div>
        </SurfaceCard>
      </section>
    </div>
  );
}

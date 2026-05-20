import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { formatCurrency } from "@/lib/status";
import { ArrowRight, Clock, TrendingDown, Wallet, type LucideIcon } from "lucide-react";

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

const SurfaceCard = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, ...style }}>
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

// ── Tipos ──────────────────────────────────────────────────────────

type AgingMode = "competencia" | "emissao_nf" | "aprovacao";

interface AgingRow {
  companyName: string;
  paymentId: string;
  valor: number;
  diasEmAberto: number | null;
  marcoDate: string | null;
  groupStatus: string;
  invoiceStatus: string | null;
}

// ── Faixas de aging ────────────────────────────────────────────────

const FAIXAS = [
  { label: "0–30 dias",  min: 0,  max: 30,  color: "green" as BubbleColor },
  { label: "31–60 dias", min: 31, max: 60,  color: "yellow" as BubbleColor },
  { label: "61–90 dias", min: 61, max: 90,  color: "red" as BubbleColor },
  { label: "90+ dias",   min: 91, max: Infinity, color: "red" as BubbleColor },
];

function getFaixa(dias: number | null) {
  if (dias === null) return null;
  return FAIXAS.find(f => dias >= f.min && dias <= f.max) ?? FAIXAS[FAIXAS.length - 1];
}

function diasDesde(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / 86_400_000);
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });
}

// ── Página principal ───────────────────────────────────────────────

export default function AgingRecebiveis() {
  const [mode, setMode] = useState<AgingMode>("competencia");
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: groups } = await supabase
        .from("payment_company_groups")
        .select("id, company_name, status, total_amount, approved_at, validated_at, payment_id")
        .not("status", "in", '("cancelado","rascunho")')
        .order("total_amount", { ascending: false })
        .limit(500);

      const paymentIds = [...new Set((groups ?? []).map((g: any) => g.payment_id))];

      const { data: payments } = await supabase
        .from("payments")
        .select("id, competence_month, status")
        .in("id", paymentIds);

      const { data: invoices } = await supabase
        .from("invoices")
        .select("payment_id, sent_at, received_at, status")
        .in("payment_id", paymentIds);

      const paymentMap = new Map((payments ?? []).map((p: any) => [p.id, p]));
      const invoiceMap = new Map<string, any>();
      for (const inv of invoices ?? []) {
        if (!invoiceMap.has(inv.payment_id) || (inv.sent_at && inv.sent_at > invoiceMap.get(inv.payment_id)?.sent_at)) {
          invoiceMap.set(inv.payment_id, inv);
        }
      }

      const built: AgingRow[] = (groups ?? []).map((g: any) => {
        const pay = paymentMap.get(g.payment_id);
        const inv = invoiceMap.get(g.payment_id);
        return {
          companyName: g.company_name ?? "Sem empresa",
          paymentId: g.payment_id,
          valor: Number(g.total_amount ?? 0),
          diasEmAberto: null,
          marcoDate: null,
          groupStatus: g.status,
          invoiceStatus: inv?.status ?? null,
          _competencia: pay?.competence_month ?? null,
          _emissao: inv?.sent_at ?? null,
          _aprovacao: g.approved_at ?? null,
        } as any;
      });

      setRows(built);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = "Aging de Recebíveis | MedPay";
    load();
  }, [load]);

  const enriched = useMemo<AgingRow[]>(() => {
    return rows.map((r: any) => {
      let marcoDate: string | null = null;
      if (mode === "competencia") marcoDate = r._competencia;
      else if (mode === "emissao_nf") marcoDate = r._emissao;
      else if (mode === "aprovacao") marcoDate = r._aprovacao;

      let refDate = marcoDate;
      if (mode === "competencia" && marcoDate) {
        const d = new Date(marcoDate);
        d.setMonth(d.getMonth() + 1, 1);
        refDate = d.toISOString();
      }

      return { ...r, marcoDate, diasEmAberto: diasDesde(refDate) };
    });
  }, [rows, mode]);

  const comMarco = useMemo(() => enriched.filter(r => r.marcoDate !== null), [enriched]);
  const semMarco = useMemo(() => enriched.filter(r => r.marcoDate === null), [enriched]);

  const kpis = useMemo(() => {
    const result = FAIXAS.map(f => ({ ...f, count: 0, valor: 0 }));
    for (const r of comMarco) {
      if (r.diasEmAberto === null) continue;
      const idx = FAIXAS.findIndex(f => r.diasEmAberto! >= f.min && r.diasEmAberto! <= f.max);
      if (idx >= 0) {
        result[idx].count++;
        result[idx].valor += r.valor;
      }
    }
    return result;
  }, [comMarco]);

  const totalEmAberto = useMemo(() => comMarco.reduce((a, r) => a + r.valor, 0), [comMarco]);

  const sorted = useMemo(() =>
    [...comMarco].sort((a, b) => (b.diasEmAberto ?? 0) - (a.diasEmAberto ?? 0)),
    [comMarco]
  );

  const modeLabels: Record<AgingMode, string> = {
    competencia: "Competência",
    emissao_nf: "Emissão NF",
    aprovacao: "Aprovação",
  };

  const modeSubtitles: Record<AgingMode, string> = {
    competencia: "Dias desde o início do mês seguinte à competência do serviço",
    emissao_nf: "Dias desde o envio do pedido de nota fiscal à empresa",
    aprovacao: "Dias desde a aprovação pela diretoria",
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 300, letterSpacing: "-0.02em", color: "hsl(var(--foreground))", lineHeight: 1.2 }}>
            Aging de <span style={{ fontWeight: 700 }}>Recebíveis</span>
          </h1>
          <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
            DF Star · {modeSubtitles[mode]}
          </p>
        </div>

        <div
          role="radiogroup"
          aria-label="Marco de referência"
          style={{ display: "inline-flex", background: "hsl(var(--muted))", borderRadius: 8, padding: 3, gap: 2 }}
        >
          {(["competencia", "emissao_nf", "aprovacao"] as AgingMode[]).map(m => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(m)}
                style={{
                  padding: "5px 11px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                  border: "none", cursor: "pointer", transition: "all 0.15s ease",
                  background: active ? "hsl(var(--primary))" : "transparent",
                  color: active ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
                }}
              >
                {modeLabels[m]}
              </button>
            );
          })}
        </div>
      </div>

      <section>
        <SectionLabel>Distribuição por faixa</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4" style={{ gap: 14 }}>
          {kpis.map(f => (
            <div key={f.label} style={{
              background: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
              borderRadius: 12, padding: "22px", display: "flex", flexDirection: "column", gap: 14,
              overflow: "hidden", minWidth: 0, position: "relative",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", color: "hsl(var(--muted-foreground))", textTransform: "uppercase" as const, lineHeight: 1.4 }}>
                  {f.label}
                </span>
                <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, ...bubbleStyle(f.color) }}>
                  <Clock size={16} strokeWidth={2} />
                </div>
              </div>
              <div style={{ fontSize: 28, fontWeight: 300, letterSpacing: "-0.03em", color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {loading ? "—" : formatCurrency(f.valor)}
              </div>
              <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                {loading ? "—" : `${f.count} empresa${f.count !== 1 ? "s" : ""}`}
              </div>
            </div>
          ))}
        </div>
      </section>

      {!loading && (
        <div style={{
          background: "#fdf5ec", border: "1px solid #9A6B3A40", borderRadius: 10,
          padding: "14px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Wallet size={16} style={{ color: "#9A6B3A" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#9A6B3A" }}>
              Total em aberto — {comMarco.length} empresa{comMarco.length !== 1 ? "s" : ""}
            </span>
          </div>
          <span style={{ fontSize: 20, fontWeight: 600, color: "#9A6B3A", fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(totalEmAberto)}
          </span>
          {semMarco.length > 0 && (
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              + {semMarco.length} empresa{semMarco.length !== 1 ? "s" : ""} sem data de {modeLabels[mode].toLowerCase()} disponível
            </span>
          )}
        </div>
      )}

      <section>
        <SectionLabel>Detalhamento por empresa</SectionLabel>
        <SurfaceCard>
          <SurfaceCardHeader
            title="Empresas em aberto"
            icon={TrendingDown}
            iconColor="copper"
            sub={`Ordenado por maior tempo em aberto · marco: ${modeLabels[mode]}`}
            rightAction={
              <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                {comMarco.length} registros
              </span>
            }
          />

          <div style={{
            display: "grid", gridTemplateColumns: "1fr 100px 120px 90px 90px",
            padding: "8px 22px", background: "hsl(var(--muted) / 0.5)",
            borderBottom: "1px solid hsl(var(--border))", gap: 12,
          }}>
            {["EMPRESA", "STATUS", "MARCO", "DIAS", "VALOR"].map(h => (
              <div key={h} style={{ fontSize: 10, fontWeight: 700, color: "hsl(var(--muted-foreground))", letterSpacing: "0.07em", textTransform: "uppercase" as const, textAlign: h === "VALOR" || h === "DIAS" ? "right" as const : "left" as const }}>
                {h}
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: "22px", display: "flex", flexDirection: "column", gap: 8 }}>
              {[1,2,3,4,5].map(i => (
                <div key={i} style={{ height: 36, background: "hsl(var(--muted))", borderRadius: 6, opacity: 0.25 }} />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div style={{ padding: "40px 22px", textAlign: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
              Nenhuma empresa com {modeLabels[mode].toLowerCase()} registrada.
            </div>
          ) : (
            <div>
              {sorted.map((r, i) => {
                const faixa = getFaixa(r.diasEmAberto);
                const borderColor = faixa?.color === "green" ? "hsl(var(--bubble-green-fg))"
                  : faixa?.color === "yellow" ? "hsl(var(--bubble-yellow-fg))"
                  : "hsl(var(--bubble-red-fg))";
                return (
                  <Link
                    key={`${r.paymentId}-${r.companyName}`}
                    to={`/pagamentos/${r.paymentId}`}
                    style={{
                      display: "grid", gridTemplateColumns: "1fr 100px 120px 90px 90px",
                      padding: "12px 22px", gap: 12, alignItems: "center",
                      borderBottom: i < sorted.length - 1 ? "1px solid hsl(var(--border))" : "none",
                      textDecoration: "none", color: "inherit",
                      borderLeft: `3px solid ${borderColor}`,
                      transition: "background 0.1s",
                    }}
                    className="hover:bg-muted/30"
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "hsl(var(--foreground))", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.companyName}
                      </div>
                    </div>

                    <div>
                      <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const,
                        letterSpacing: "0.05em", borderRadius: 20, padding: "2px 7px",
                        background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))",
                        whiteSpace: "nowrap",
                      }}>
                        {r.groupStatus.replace(/_/g, " ")}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                      {fmtDate(r.marcoDate)}
                    </div>

                    <div style={{ textAlign: "right" }}>
                      {r.diasEmAberto !== null ? (
                        <span style={{
                          fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                          color: faixa?.color === "green" ? "hsl(var(--bubble-green-fg))"
                            : faixa?.color === "yellow" ? "hsl(var(--bubble-yellow-fg))"
                            : "hsl(var(--bubble-red-fg))",
                        }}>
                          {r.diasEmAberto}d
                        </span>
                      ) : <span style={{ color: "hsl(var(--muted-foreground))" }}>—</span>}
                    </div>

                    <div style={{ fontSize: 12, fontWeight: 700, color: "hsl(var(--foreground))", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                      {formatCurrency(r.valor)}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {!loading && semMarco.length > 0 && (
            <div style={{ borderTop: "1px solid hsl(var(--border))", padding: "14px 22px", background: "hsl(var(--muted) / 0.3)" }}>
              <div style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", marginBottom: 8, fontWeight: 600 }}>
                Sem data de {modeLabels[mode].toLowerCase()} registrada ({semMarco.length} empresa{semMarco.length !== 1 ? "s" : ""})
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {semMarco.slice(0, 5).map((r, i) => (
                  <Link
                    key={`sem-${i}`}
                    to={`/pagamentos/${r.paymentId}`}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, color: "hsl(var(--foreground))", textDecoration: "none" }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{r.companyName}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0, color: "hsl(var(--muted-foreground))" }}>{formatCurrency(r.valor)}</span>
                    <ArrowRight size={12} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                  </Link>
                ))}
                {semMarco.length > 5 && (
                  <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
                    + {semMarco.length - 5} outras
                  </span>
                )}
              </div>
            </div>
          )}
        </SurfaceCard>
      </section>
    </div>
  );
}

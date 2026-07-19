import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShieldAlert,
  AlertTriangle,
  DollarSign,
  Layers,
  Activity,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";
import type { TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

// Fontes de risco consolidadas pela RPC get_risk_summary.
// Track é ignorado nesta versão: as RPCs somam por hospital ativo.
type SummaryRow = {
  tipo: string;
  qtd: number;
  valor_risco: number;
  lotes_afetados: number;
};

type DetailRow = {
  payment_id: string;
  reference: string | null;
  company_name: string | null;
  doctor_name: string | null;
  specialty: string | null;
  procedure_code: string | null;
  gross_amount: number | null;
  expected_amount: number | null;
  divergencia_pct: number | null;
  competencia: string | null;
  status: string | null;
};

const fmtCompetencia = (raw: string | null | undefined): string => {
  if (!raw) return "—";
  // Formata YYYY-MM-DD sem passar por Date para evitar deslocamento UTC→BRT
  const [y, m] = raw.slice(0, 10).split("-");
  const meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const idx = Number(m) - 1;
  return `${meses[idx] ?? "?"}/${y?.slice(2)}`;
};

export function ValidationRiskSection(_: { track?: TrackFilterValue } = {}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailsByTipo, setDetailsByTipo] = useState<Record<string, DetailRow[] | "loading">>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase.rpc("get_risk_summary", { p_months_back: 6 });
      if (cancelled) return;
      if (error) {
        setRows([]);
      } else {
        setRows(((data ?? []) as SummaryRow[]).map((r) => ({
          ...r,
          qtd: Number(r.qtd ?? 0),
          valor_risco: Number(r.valor_risco ?? 0),
          lotes_afetados: Number(r.lotes_afetados ?? 0),
        })));
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (tipo: string) => {
    if (expanded === tipo) {
      setExpanded(null);
      return;
    }
    setExpanded(tipo);
    if (detailsByTipo[tipo] && detailsByTipo[tipo] !== "loading") return;
    setDetailsByTipo((s) => ({ ...s, [tipo]: "loading" }));
    const { data, error } = await supabase.rpc("get_risk_details", { p_tipo: tipo, p_limit: 30 });
    setDetailsByTipo((s) => ({
      ...s,
      [tipo]: error ? [] : ((data ?? []) as DetailRow[]),
    }));
  };

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-6">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-10 rounded mb-2 opacity-30"
            style={{ background: "hsl(var(--muted))" }}
          />
        ))}
      </div>
    );
  }

  const totalAlertas = rows.reduce((s, r) => s + r.qtd, 0);
  const totalValor = rows.reduce((s, r) => s + r.valor_risco, 0);
  const totalLotes = rows.reduce((s, r) => s + r.lotes_afetados, 0); // soma simples (não distinct entre fontes)
  const fontesAtivas = rows.filter((r) => r.qtd > 0).length;

  const kpis = [
    { label: "Alertas ativos", value: totalAlertas.toLocaleString("pt-BR"), Icon: AlertTriangle },
    { label: "Valor em risco", value: formatCurrency(totalValor), Icon: DollarSign },
    { label: "Lotes afetados", value: totalLotes.toLocaleString("pt-BR"), Icon: Layers },
    { label: "Fontes ativas", value: `${fontesAtivas} de ${rows.length || 3}`, Icon: Activity },
  ];

  return (
    <section className="space-y-4">
      {/* KPIs no topo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map(({ label, value, Icon }) => (
          <div
            key={label}
            className="rounded-xl border bg-card p-4 flex items-center gap-3"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <div
              className="flex items-center justify-center rounded-lg"
              style={{
                width: 36,
                height: 36,
                background: "hsl(var(--muted))",
                color: "hsl(var(--muted-foreground))",
              }}
            >
              <Icon size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabela de fontes de risco */}
      {totalAlertas === 0 ? (
        <div
          className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          Nenhum alerta identificado nos últimos 6 meses.
        </div>
      ) : (
        <div className="rounded-xl border bg-card" style={{ borderColor: "hsl(var(--border))" }}>
          <div
            className="flex items-center gap-2.5 px-5 py-4"
            style={{ borderBottom: "1px solid hsl(var(--border))" }}
          >
            <div
              className="flex items-center justify-center rounded-lg"
              style={{
                width: 28,
                height: 28,
                background: "hsl(var(--accent) / 0.08)",
                color: "hsl(var(--accent))",
              }}
            >
              <ShieldAlert size={14} />
            </div>
            <h3 className="text-sm font-semibold tracking-tight">Fontes de risco (últimos 6 meses)</h3>
          </div>

          <div>
            {rows.map((r, i) => {
              const isOpen = expanded === r.tipo;
              const details = detailsByTipo[r.tipo];
              return (
                <div key={r.tipo}>
                  <div
                    className="flex items-center gap-3 px-5 py-3.5"
                    style={{
                      borderBottom: i < rows.length - 1 || isOpen ? "1px solid hsl(var(--border))" : "none",
                      background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.25)",
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{r.tipo}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {r.qtd.toLocaleString("pt-BR")} item{r.qtd !== 1 ? "s" : ""} ·{" "}
                        {r.lotes_afetados.toLocaleString("pt-BR")} lote
                        {r.lotes_afetados !== 1 ? "s" : ""}
                      </div>
                    </div>
                    <div
                      className="rounded-lg px-3 py-1 text-sm font-semibold tabular-nums flex-shrink-0"
                      style={{
                        background: "hsl(var(--accent) / 0.08)",
                        color: "hsl(var(--accent))",
                        border: "1px solid hsl(var(--accent) / 0.2)",
                      }}
                    >
                      {formatCurrency(r.valor_risco)}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(r.tipo)}
                      disabled={r.qtd === 0}
                      className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ color: "hsl(var(--accent))" }}
                    >
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      Ver detalhes
                    </button>
                  </div>

                  {isOpen && (
                    <div
                      className="px-5 py-4"
                      style={{
                        background: "hsl(var(--muted) / 0.15)",
                        borderBottom: i < rows.length - 1 ? "1px solid hsl(var(--border))" : "none",
                      }}
                    >
                      {details === "loading" || details === undefined ? (
                        <div className="text-xs text-muted-foreground py-4 text-center">
                          Carregando detalhes…
                        </div>
                      ) : details.length === 0 ? (
                        <div className="text-xs text-muted-foreground py-4 text-center">
                          Nenhum detalhe disponível.
                        </div>
                      ) : (
                        <div className="overflow-x-auto -mx-1">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-muted-foreground border-b" style={{ borderColor: "hsl(var(--border))" }}>
                                <th className="py-2 px-2 font-medium">Lote</th>
                                <th className="py-2 px-2 font-medium">Empresa</th>
                                <th className="py-2 px-2 font-medium">Médico</th>
                                <th className="py-2 px-2 font-medium">Especialidade</th>
                                <th className="py-2 px-2 font-medium text-right">Bruto</th>
                                <th className="py-2 px-2 font-medium text-right">Esperado</th>
                                <th className="py-2 px-2 font-medium text-right">Diverg.</th>
                                <th className="py-2 px-2 font-medium">Comp.</th>
                              </tr>
                            </thead>
                            <tbody>
                              {details.map((d, idx) => {
                                const div = d.divergencia_pct == null ? null : Number(d.divergencia_pct);
                                const divColor =
                                  div == null
                                    ? "hsl(var(--muted-foreground))"
                                    : Math.abs(div) > 30
                                      ? "hsl(var(--destructive))"
                                      : "hsl(var(--accent))";
                                return (
                                  <tr
                                    key={`${d.payment_id}-${idx}`}
                                    className="border-b hover:bg-muted/30"
                                    style={{ borderColor: "hsl(var(--border) / 0.5)" }}
                                  >
                                    <td className="py-2 px-2">
                                      <Link
                                        to={`/pagamentos/${d.payment_id}`}
                                        className="inline-flex items-center gap-1 hover:underline"
                                        style={{ color: "hsl(var(--accent))" }}
                                      >
                                        <span className="truncate max-w-[180px]" title={d.reference ?? ""}>
                                          {d.reference ?? "—"}
                                        </span>
                                        <ExternalLink size={10} />
                                      </Link>
                                    </td>
                                    <td className="py-2 px-2">
                                      <span className="truncate max-w-[160px] inline-block align-middle" title={d.company_name ?? ""}>
                                        {d.company_name ?? "—"}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2">
                                      <span className="truncate max-w-[140px] inline-block align-middle" title={d.doctor_name ?? ""}>
                                        {d.doctor_name ?? "—"}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2">
                                      <span className="truncate max-w-[120px] inline-block align-middle" title={d.specialty ?? ""}>
                                        {d.specialty ?? "—"}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2 text-right tabular-nums">
                                      {formatCurrency(Number(d.gross_amount ?? 0))}
                                    </td>
                                    <td className="py-2 px-2 text-right tabular-nums text-muted-foreground">
                                      {d.expected_amount == null || Number(d.expected_amount) === 0
                                        ? "—"
                                        : formatCurrency(Number(d.expected_amount))}
                                    </td>
                                    <td
                                      className="py-2 px-2 text-right tabular-nums font-medium"
                                      style={{ color: divColor }}
                                    >
                                      {div == null ? "—" : `${div > 0 ? "+" : ""}${div.toFixed(1)}%`}
                                    </td>
                                    <td className="py-2 px-2 text-muted-foreground">
                                      {fmtCompetencia(d.competencia)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                          {details.length >= 30 && (
                            <div className="text-[11px] text-muted-foreground pt-2 text-right">
                              Mostrando os 30 itens de maior impacto.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

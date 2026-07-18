import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  LabelList,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { TrendingUp, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { formatBRL, mean } from "@/lib/financialStats";
import { toRpcTrack, type TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

function formatShortBRL(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Rótulo do eixo X: "Jan/26" a partir do bucket "2026-01".
function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Math.max(0, Math.min(11, parseInt(m ?? "1", 10) - 1));
  return `${MONTHS_PT[idx]}/${(y ?? "").slice(2)}`;
}

type Grouping = "especialidade" | "empresa";

interface TrendRow {
  group_key: string;
  month_bucket: string;
  total: number;
}

export const LossTrendTab = ({ track = "all" }: { track?: TrackFilterValue } = {}) => {
  const [grouping, setGrouping] = useState<Grouping>("especialidade");
  const [rows, setRows] = useState<TrendRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const today = new Date();
        const current = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        const { data, error: rpcError } = await supabase.rpc("get_spend_trend", {
          p_current_month: current,
          p_months_back: 6,
          p_grouping: grouping,
          p_track: toRpcTrack(track),
        } as never);
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
          setRows([]);
          return;
        }
        setRows((data as TrendRow[]) ?? []);
      } catch (err) {
        if (cancelled) return;
        // Falha inesperada: destrava o loading e mostra erro em vez de tela em branco
        setError(err instanceof Error ? err.message : String(err));
        setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grouping, track]);

  const { chartData, series, alerts, monthlyTotals, currentYm } = useMemo(() => {
    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const empty = {
      chartData: [] as Record<string, number | string | boolean>[],
      series: [] as string[],
      alerts: [] as { key: string; pct: number }[],
      monthlyTotals: [] as { month: string; total: number; deltaPct: number | null; partial: boolean }[],
      currentYm: curYm,
    };
    if (!rows || rows.length === 0) return empty;

    // Inclui TODOS os meses retornados pela RPC — mês corrente marcado como parcial.
    const months = Array.from(new Set(rows.map((r) => r.month_bucket))).sort();
    const totalsByMonth = new Map<string, number>();
    for (const r of rows) {
      totalsByMonth.set(r.month_bucket, (totalsByMonth.get(r.month_bucket) ?? 0) + Number(r.total));
    }

    const topKeys = Array.from(
      rows.reduce(
        (m, r) => m.set(r.group_key, (m.get(r.group_key) ?? 0) + Number(r.total)),
        new Map<string, number>(),
      ),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k]) => k);

    const data = months.map((m) => {
      const ym = m.slice(0, 7);
      const o: Record<string, number | string | boolean> = {
        month: ym,
        monthLabel: formatMonthLabel(ym),
        partial: ym === curYm,
        total: totalsByMonth.get(m) ?? 0,
      };
      for (const k of topKeys) {
        const found = rows.find((r) => r.month_bucket === m && r.group_key === k);
        o[k] = Number(found?.total ?? 0);
      }
      return o;
    });

    const monthlyTotals = months.map((m, idx) => {
      const total = totalsByMonth.get(m) ?? 0;
      const prev = idx > 0 ? totalsByMonth.get(months[idx - 1]) ?? 0 : 0;
      const deltaPct = idx > 0 && prev > 0 ? ((total - prev) / prev) * 100 : null;
      return { month: m.slice(0, 7), total, deltaPct, partial: m.slice(0, 7) === curYm };
    });

    // Alertas de alta ignoram o mês corrente (parcial) para não gerar falso positivo.
    const closedMonths = months.filter((m) => m.slice(0, 7) !== curYm);
    const alertList: { key: string; pct: number }[] = [];
    for (const k of topKeys) {
      const seriesVals = closedMonths.map(
        (m) => Number(rows.find((r) => r.month_bucket === m && r.group_key === k)?.total ?? 0),
      );
      if (seriesVals.length < 3) continue;
      const last = seriesVals[seriesVals.length - 1];
      const baseline = mean(seriesVals.slice(0, -1));
      if (baseline > 0 && last > baseline * 1.15) {
        alertList.push({ key: k, pct: ((last - baseline) / baseline) * 100 });
      }
    }
    return {
      chartData: data,
      series: topKeys,
      alerts: alertList,
      monthlyTotals,
      currentYm: curYm,
    };
  }, [rows]);

  // Cores secundárias para as linhas das top especialidades/empresas — a linha
  // TOTAL usa a primary do Exacta e é o eixo de leitura do gráfico.
  const secondaryColors = ["#94a3b8", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Tendência por mês"
        icon={TrendingUp}
        iconColor="yellow"
        subtitle="Total pago consolidado — com top 6 grupos como referência"
        rightAction={
          <div className="flex gap-1">
            <Button size="sm" variant={grouping === "especialidade" ? "default" : "outline"} onClick={() => setGrouping("especialidade")}>
              Especialidade
            </Button>
            <Button size="sm" variant={grouping === "empresa" ? "default" : "outline"} onClick={() => setGrouping("empresa")}>
              Empresa
            </Button>
          </div>
        }
      />
      <div className="p-4 space-y-4">
        {!rows ? (
          <Skeleton className="h-96 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive text-center py-8">
            Falha ao carregar tendência: {error}
          </p>
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem dados no período.</p>
        ) : (
          <>
            {/* Cards de resumo mensal — acima do gráfico */}
            {monthlyTotals.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {monthlyTotals.map((mt) => {
                  const up = (mt.deltaPct ?? 0) > 0;
                  const down = (mt.deltaPct ?? 0) < 0;
                  return (
                    <div
                      key={mt.month}
                      className={`flex flex-col rounded-md border px-3 py-2 min-w-[120px] ${
                        mt.partial ? "border-dashed bg-muted/20" : "bg-muted/30"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        {formatMonthLabel(mt.month)}
                        {mt.partial && (
                          <span className="rounded-sm bg-muted px-1 py-0.5 text-[9px] font-medium normal-case tracking-normal text-muted-foreground">
                            parcial
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-medium tabular-nums">{formatShortBRL(mt.total)}</span>
                      <span className="flex items-center gap-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {mt.deltaPct === null ? (
                          <>
                            <Minus className="h-3 w-3" /> —
                          </>
                        ) : up ? (
                          <>
                            <ArrowUp className="h-3 w-3 text-destructive" />
                            <span className="text-destructive">+{mt.deltaPct.toFixed(1)}%</span>
                          </>
                        ) : down ? (
                          <>
                            <ArrowDown className="h-3 w-3 text-success" />
                            <span className="text-success">{mt.deltaPct.toFixed(1)}%</span>
                          </>
                        ) : (
                          <>
                            <Minus className="h-3 w-3" /> 0%
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Gráfico: área azul (total consolidado) + linhas finas dos top 6 grupos */}
            <div className="h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 32, right: 24, left: 0, bottom: 8 }}>
                  <defs>
                    <linearGradient id="lossTrendTotalArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(0, 61, 165, 0.15)" />
                      <stop offset="100%" stopColor="rgba(0, 61, 165, 0.02)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="monthLabel" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(v) => formatShortBRL(v as number)}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number, name: string) => [formatBRL(v), name === "total" ? "Total" : name]}
                    labelFormatter={(label, payload) => {
                      const partial = payload?.[0]?.payload?.partial;
                      return partial ? `${label} (parcial)` : String(label);
                    }}
                    itemSorter={(item) => -Number(item.value ?? 0)}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    formatter={(value) => (value === "total" ? "Total consolidado" : value)}
                  />

                  {/* Área com gradiente da linha TOTAL — pintada primeiro para ficar atrás */}
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="none"
                    fill="url(#lossTrendTotalArea)"
                    isAnimationActive={false}
                    legendType="none"
                  />

                  {/* Linhas finas das top 6 séries — referência secundária */}
                  {series.map((k, i) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stroke={secondaryColors[i % secondaryColors.length]}
                      strokeWidth={1.5}
                      dot={{ r: 2 }}
                      activeDot={{ r: 4 }}
                      strokeOpacity={0.75}
                    />
                  ))}

                  {/* Linha TOTAL — protagonista, mais grossa, na cor primary do Exacta */}
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#003DA5"
                    strokeWidth={3}
                    dot={(props: Record<string, unknown>) => {
                      const payload = props.payload as { partial?: boolean } | undefined;
                      const cx = props.cx as number;
                      const cy = props.cy as number;
                      const key = String((props as { key?: string }).key ?? `${cx}-${cy}`);
                      // Ponto do mês parcial fica com borda tracejada (anel) para sinalizar dado incompleto
                      if (payload?.partial) {
                        return (
                          <g key={key}>
                            <circle cx={cx} cy={cy} r={6} fill="hsl(var(--card))" stroke="#003DA5" strokeWidth={2} strokeDasharray="3 2" />
                            <circle cx={cx} cy={cy} r={2.5} fill="#003DA5" />
                          </g>
                        );
                      }
                      return <circle key={key} cx={cx} cy={cy} r={4} fill="#003DA5" />;
                    }}
                    activeDot={{ r: 6, fill: "#003DA5" }}
                  >
                    {/* Data label em TODOS os pontos da linha total */}
                    <LabelList
                      dataKey="total"
                      position="top"
                      content={(props: Record<string, unknown>) => {
                        const value = props.value as number | undefined;
                        const x = props.x as number;
                        const y = props.y as number;
                        const idx = props.index as number;
                        if (value == null) return null;
                        const partial = (chartData[idx] as { partial?: boolean } | undefined)?.partial;
                        return (
                          <text
                            key={`total-label-${idx}`}
                            x={x}
                            y={y - 12}
                            fontSize={11}
                            fontWeight={600}
                            textAnchor="middle"
                            fill="#003DA5"
                          >
                            {formatShortBRL(Number(value))}
                            {partial ? "*" : ""}
                          </text>
                        );
                      }}
                    />
                  </Line>
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {chartData.some((d) => (d as { partial?: boolean }).partial) && (
              <p className="text-xs text-muted-foreground italic">
                * O mês corrente ({formatMonthLabel(currentYm)}) é parcial — inclui apenas lotes já processados até hoje.
              </p>
            )}

            {alerts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Alertas de alta</p>
                <div className="flex flex-wrap gap-2">
                  {alerts.map((a) => (
                    <Badge key={a.key} variant="destructive">
                      {a.key}: +{a.pct.toFixed(0)}%
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </SurfaceCard>
  );
};

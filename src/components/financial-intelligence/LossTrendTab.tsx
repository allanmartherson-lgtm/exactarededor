import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  LineChart,
  Line,
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
import { formatBRL, mean, median } from "@/lib/financialStats";
import { toRpcTrack, type TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

function formatShortBRL(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
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

  useEffect(() => {
    setRows(null);
    (async () => {
      const today = new Date();
      const current = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const { data } = await supabase.rpc("get_spend_trend", {
        p_current_month: current,
        p_months_back: 6,
        p_grouping: grouping,
        p_track: toRpcTrack(track),
      } as never);
      setRows((data as TrendRow[]) ?? []);
    })();
  }, [grouping, track]);

  const { chartData, series, alerts, hiddenCount, completeCount, monthlyTotals } = useMemo(() => {
    const empty = {
      chartData: [] as Record<string, number | string>[],
      series: [] as string[],
      alerts: [] as { key: string; pct: number }[],
      hiddenCount: 0,
      completeCount: 0,
      monthlyTotals: [] as { month: string; total: number; deltaPct: number | null }[],
    };
    if (!rows) return empty;

    const allMonths = Array.from(new Set(rows.map((r) => r.month_bucket))).sort();
    const totalsByMonth = new Map<string, number>();
    for (const r of rows) {
      totalsByMonth.set(r.month_bucket, (totalsByMonth.get(r.month_bucket) ?? 0) + Number(r.total));
    }

    const now = new Date();
    const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const nonCurrent = allMonths.filter((m) => m.slice(0, 7) !== curYm);

    const med = nonCurrent.length >= 2 ? median(nonCurrent.map((m) => totalsByMonth.get(m) ?? 0)) : 0;
    const threshold = med * 0.3;
    const months = nonCurrent.filter((m) => (totalsByMonth.get(m) ?? 0) >= threshold);
    const hiddenCount = allMonths.length - months.length;

    if (months.length < 2) {
      return { ...empty, hiddenCount, completeCount: months.length };
    }

    const filteredRows = rows.filter((r) => months.includes(r.month_bucket));
    const topKeys = Array.from(
      filteredRows.reduce(
        (m, r) => m.set(r.group_key, (m.get(r.group_key) ?? 0) + Number(r.total)),
        new Map<string, number>(),
      ),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k]) => k);

    const data = months.map((m) => {
      const o: Record<string, number | string> = { month: m.slice(0, 7) };
      for (const k of topKeys) {
        const found = filteredRows.find((r) => r.month_bucket === m && r.group_key === k);
        o[k] = Number(found?.total ?? 0);
      }
      return o;
    });

    const monthlyTotals = months.map((m, idx) => {
      const total = totalsByMonth.get(m) ?? 0;
      const prev = idx > 0 ? totalsByMonth.get(months[idx - 1]) ?? 0 : 0;
      const deltaPct = idx > 0 && prev > 0 ? ((total - prev) / prev) * 100 : null;
      return { month: m.slice(0, 7), total, deltaPct };
    });

    const alertList: { key: string; pct: number }[] = [];
    for (const k of topKeys) {
      const seriesVals = months.map(
        (m) => Number(filteredRows.find((r) => r.month_bucket === m && r.group_key === k)?.total ?? 0),
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
      hiddenCount,
      completeCount: months.length,
      monthlyTotals,
    };
  }, [rows]);

  const colors = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"];
  

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Tendência por mês"
        icon={TrendingUp}
        iconColor="yellow"
        subtitle="Total pago por mês — top 6 grupos"
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
          <Skeleton className="h-72 w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {rows.length === 0
              ? "Sem dados."
              : `Dados insuficientes para tendência confiável — são necessários ao menos 2 meses completos (atualmente: ${completeCount}).`}
          </p>
        ) : (
          <>
            {monthlyTotals.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {monthlyTotals.map((mt) => {
                  const up = (mt.deltaPct ?? 0) > 0;
                  const down = (mt.deltaPct ?? 0) < 0;
                  return (
                    <div
                      key={mt.month}
                      className="flex flex-col rounded-md border bg-muted/30 px-3 py-2 min-w-[110px]"
                    >
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                        {mt.month}
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
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(v) => formatShortBRL(v as number)}
                    width={70}
                  />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number) => formatBRL(v)}
                    itemSorter={(item) => -Number(item.value ?? 0)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  {series.map((k, i) => (
                    <Line
                      key={k}
                      type="monotone"
                      dataKey={k}
                      stroke={colors[i % colors.length]}
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                    >
                      <LabelList
                        dataKey={k}
                        position="top"
                        content={(props: Record<string, unknown>) => {
                          const idx = props.index as number;
                          const value = props.value as number | undefined;
                          const x = props.x as number;
                          const y = props.y as number;
                          if (idx !== chartData.length - 1 || value == null) return null;
                          return (
                            <text
                              x={x}
                              y={y - 8}
                              fontSize={10}
                              textAnchor="middle"
                              fill="hsl(var(--muted-foreground))"
                            >
                              {formatShortBRL(Number(value))}
                            </text>
                          );
                        }}
                      />
                    </Line>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            {hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground italic">
                Meses incompletos/parciais são ocultados ({hiddenCount} ocultado{hiddenCount > 1 ? "s" : ""}).
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

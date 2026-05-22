import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { TrendingUp } from "lucide-react";
import { formatBRL, mean } from "@/lib/financialStats";

type Grouping = "specialty" | "company";

interface PivotRow {
  group_key: string;
  parent_key: string | null;
  month_bucket: string;
  total: number;
}

export const LossTrendTab = () => {
  const [grouping, setGrouping] = useState<Grouping>("specialty");
  const [rows, setRows] = useState<PivotRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    (async () => {
      const today = new Date();
      const current = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
      const { data } = await supabase.rpc("get_payment_pivot", {
        p_current_month: current,
        p_months_back: 6,
        p_grouping: grouping,
      });
      setRows((data as PivotRow[]) ?? []);
    })();
  }, [grouping]);

  const { chartData, series, alerts } = useMemo(() => {
    if (!rows) return { chartData: [], series: [] as string[], alerts: [] as { key: string; pct: number }[] };
    const months = Array.from(new Set(rows.map((r) => r.month_bucket))).sort();
    const topKeys = Array.from(
      rows.reduce((m, r) => m.set(r.group_key, (m.get(r.group_key) ?? 0) + Number(r.total)), new Map<string, number>()),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k]) => k);

    const data = months.map((m) => {
      const o: Record<string, number | string> = { month: m.slice(0, 7) };
      for (const k of topKeys) {
        const found = rows.find((r) => r.month_bucket === m && r.group_key === k);
        o[k] = Number(found?.total ?? 0);
      }
      return o;
    });

    const alertList: { key: string; pct: number }[] = [];
    for (const k of topKeys) {
      const series = months.map((m) => Number(rows.find((r) => r.month_bucket === m && r.group_key === k)?.total ?? 0));
      if (series.length < 6) continue;
      const last = series[series.length - 1];
      const baseline = mean(series.slice(0, -1));
      if (baseline > 0 && last > baseline * 1.15) {
        alertList.push({ key: k, pct: ((last - baseline) / baseline) * 100 });
      }
    }
    return { chartData: data, series: topKeys, alerts: alertList };
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
            <Button size="sm" variant={grouping === "specialty" ? "default" : "outline"} onClick={() => setGrouping("specialty")}>
              Especialidade
            </Button>
            <Button size="sm" variant={grouping === "company" ? "default" : "outline"} onClick={() => setGrouping("company")}>
              Empresa
            </Button>
          </div>
        }
      />
      <div className="p-4 space-y-4">
        {!rows ? (
          <Skeleton className="h-72 w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Sem dados.</p>
        ) : (
          <>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={(v) => formatBRL(v as number)} width={100} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number) => formatBRL(v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {series.map((k, i) => (
                    <Line key={k} type="monotone" dataKey={k} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
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

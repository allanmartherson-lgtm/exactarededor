import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { Calculator, ArrowDown, ArrowUp, Minus, Info, TrendingUp, TrendingDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBRL, mean, median } from "@/lib/financialStats";
import type { TrackFilterValue } from "@/components/shared/PaymentTrackFilter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface PaymentRow {
  competence_month: string | null;
  total_amount: number;
  status: string;
}

interface ItemRow {
  sector_slug: string | null;
  specialty: string | null;
  gross_amount: number | null;
  payments: { competence_month: string | null } | { competence_month: string | null }[] | null;
}

interface SectorRow {
  slug: string | null;
  classification: string | null;
}

const EXCLUDED = new Set(["rascunho", "cancelado", "rejeitado"]);
const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmtMonth(ym: string): string {
  const [year, month] = ym.split("-");
  if (!year || !month) return ym;
  const idx = parseInt(month, 10) - 1;
  if (idx < 0 || idx > 11) return ym;
  return `${MONTHS_PT[idx]}/${year.slice(2)}`;
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtCompact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toFixed(0);
}

function itemCompetence(it: ItemRow): string | null {
  const p = it.payments;
  if (!p) return null;
  const row = Array.isArray(p) ? p[0] : p;
  return row?.competence_month ? row.competence_month.slice(0, 7) : null;
}

export const ProjectionTab = ({ track = "all" }: { track?: TrackFilterValue } = {}) => {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [sectorMap, setSectorMap] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      let pq = supabase
        .from("payments")
        .select("competence_month,total_amount,status,payment_track")
        .gte("competence_month", cutoffDate);
      let iq = supabase
        .from("payment_items")
        .select("sector_slug, specialty, gross_amount, payments!inner(competence_month, payment_track, status)")
        .gte("payments.competence_month", cutoffDate)
        .not("gross_amount", "is", null)
        .not("payments.status", "in", '("rascunho","cancelado","rejeitado")');
      if (track === "habitual" || track === "prioritario") {
        pq = pq.eq("payment_track", track);
        iq = iq.eq("payments.payment_track", track);
      } else if (track === "nao_classificado") {
        pq = pq.is("payment_track", null);
        iq = iq.is("payments.payment_track", null);
      }
      const [{ data: pData }, { data: iData }, { data: sData }] = await Promise.all([
        pq,
        iq,
        supabase.from("sectors").select("slug, classification"),
      ]);
      setRows((pData as unknown as PaymentRow[]) ?? []);
      setItems((iData as unknown as ItemRow[]) ?? []);
      const map = new Map<string, string>();
      for (const s of (sData as SectorRow[]) ?? []) {
        if (s.slug && s.classification) map.set(s.slug.trim(), s.classification);
      }
      setSectorMap(map);
    })();
  }, [track]);

  const result = useMemo(() => {
    if (!rows) return null;
    const curYm = currentYm();
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.competence_month || EXCLUDED.has(r.status)) continue;
      const key = r.competence_month.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(r.total_amount));
    }
    const allMonths = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    const partial = allMonths.find(([m]) => m === curYm) ?? null;
    const nonCurrent = allMonths.filter(([m]) => m !== curYm);

    const incompleteSet = new Set<string>();
    if (nonCurrent.length >= 2) {
      const values = nonCurrent.map(([, v]) => v);
      const med = median(values);
      const threshold = med * 0.3;
      for (const [m, v] of nonCurrent) {
        if (v < threshold) incompleteSet.add(m);
      }
    }

    const completeMonths = nonCurrent.filter(([m]) => !incompleteSet.has(m));
    const monthsWithFlag = nonCurrent.map(([m, v]) => ({
      ym: m,
      val: v,
      flag: incompleteSet.has(m) ? ("incompleto" as const) : ("ok" as const),
    }));

    if (completeMonths.length < 3) {
      return {
        hasProjection: false as const,
        completeCount: completeMonths.length,
        projection: 0,
        lastClosed: 0,
        lastClosedYm: null as string | null,
        delta: 0,
        monthsWithFlag,
        partial,
        allMonthsMap: map,
      };
    }

    const last3 = completeMonths.slice(-3).map(([, v]) => v);
    const projection = mean(last3);
    const [lastClosedYm, lastClosed] = completeMonths[completeMonths.length - 1];
    const delta = lastClosed > 0 ? ((projection - lastClosed) / lastClosed) * 100 : 0;
    return {
      hasProjection: true as const,
      completeCount: completeMonths.length,
      projection,
      lastClosed,
      lastClosedYm,
      delta,
      monthsWithFlag,
      partial,
      allMonthsMap: map,
    };
  }, [rows]);

  // Bar chart data
  const chartData = useMemo(() => {
    if (!result) return [];
    const data: Array<{ ym: string; label: string; val: number; kind: "complete" | "partial" | "projection" }> = [];
    for (const m of result.monthsWithFlag) {
      if (m.flag === "incompleto") continue;
      data.push({ ym: m.ym, label: fmtMonth(m.ym), val: m.val, kind: "complete" });
    }
    if (result.partial) {
      data.push({ ym: result.partial[0], label: fmtMonth(result.partial[0]), val: result.partial[1], kind: "partial" });
    }
    if (result.hasProjection) {
      // next month after current
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      const nextYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      data.push({ ym: nextYm, label: `${fmtMonth(nextYm)} (proj.)`, val: result.projection, kind: "projection" });
    }
    return data;
  }, [result]);

  // Annualized projection
  const annualized = useMemo(() => {
    if (!result?.hasProjection) return null;
    const now = new Date();
    const year = now.getFullYear();
    const curMonth = now.getMonth() + 1; // 1..12
    let closedSum = 0;
    for (const [ym, v] of result.allMonthsMap.entries()) {
      const [y, m] = ym.split("-");
      if (parseInt(y, 10) === year && parseInt(m, 10) < curMonth) closedSum += v;
    }
    const remaining = 12 - (curMonth - 1); // includes current month
    const total = closedSum + result.projection * remaining;
    return total;
  }, [result]);

  // Specialty breakdown
  const specialtyBreakdown = useMemo(() => {
    if (!items || !result) return null;
    // determine last 3 complete competences
    const complete = result.monthsWithFlag.filter((m) => m.flag === "ok").map((m) => m.ym);
    const last3 = new Set(complete.slice(-3));
    const lastClosed = result.lastClosedYm;

    const bySpec3M = new Map<string, number>();
    const bySpecLast = new Map<string, number>();

    for (const it of items) {
      const v = Number(it.gross_amount) || 0;
      if (v <= 0) continue;
      const spec = it.specialty?.trim() || "(sem especialidade)";
      const ym = itemCompetence(it);
      if (!ym) continue;
      if (last3.has(ym)) bySpec3M.set(spec, (bySpec3M.get(spec) ?? 0) + v);
      if (lastClosed && ym === lastClosed) bySpecLast.set(spec, (bySpecLast.get(spec) ?? 0) + v);
    }

    const projection = result.hasProjection ? result.projection : 0;
    const totalAvg = Array.from(bySpec3M.values()).reduce((a, b) => a + b, 0) / Math.max(last3.size, 1);

    return Array.from(bySpec3M.entries())
      .map(([spec, sum3m]) => {
        const avg = sum3m / Math.max(last3.size, 1);
        const proj = totalAvg > 0 ? (avg / totalAvg) * projection : 0;
        const lastVal = bySpecLast.get(spec) ?? 0;
        const trendPct = avg > 0 ? ((lastVal - avg) / avg) * 100 : 0;
        return { spec, avg, proj, trendPct };
      })
      .sort((a, b) => b.proj - a.proj)
      .slice(0, 10);
  }, [items, result]);

  const COLORS = {
    complete: "#003DA5",
    partial: "#71C5E8",
    projection: "#C6A27C",
  };

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Projeção do próximo mês"
        icon={Calculator}
        iconColor="blue"
        subtitle="Média dos últimos 3 meses completos — ignora meses parciais/incompletos"
      />
      <div className="p-6">
        {!result ? (
          <Skeleton className="h-32 w-full" />
        ) : result.hasProjection ? (
          <TooltipProvider delayDuration={200}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg border p-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Projeção
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Como é calculada a projeção">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      Média simples dos últimos 3 meses fechados (mês corrente e meses incompletos — total &lt; 30% da mediana — são ignorados).
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-3xl font-light tabular-nums">{formatBRL(result.projection)}</p>
              </div>
              <div className="rounded-lg border p-5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                  Mês de referência {result.lastClosedYm ? `(${fmtMonth(result.lastClosedYm)})` : ""}
                </p>
                <p className="text-3xl font-light tabular-nums">{formatBRL(result.lastClosed)}</p>
              </div>
              <div className="rounded-lg border p-5">
                <div className="flex items-center gap-1.5 mb-2">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Variação vs último completo
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Como é calculada a variação">
                        <Info className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      (projeção − último mês fechado) ÷ último mês fechado. Positivo (vermelho) = tendência de alta vs o último mês; negativo (verde) = tendência de queda.
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-3xl font-light tabular-nums flex items-center gap-2">
                  {result.delta > 0 ? (
                    <ArrowUp className="h-6 w-6 text-destructive" />
                  ) : result.delta < 0 ? (
                    <ArrowDown className="h-6 w-6 text-success" />
                  ) : (
                    <Minus className="h-6 w-6 text-muted-foreground" />
                  )}
                  {result.delta.toFixed(1)}%
                </p>
              </div>
            </div>

            {annualized !== null && (
              <p className="mt-4 text-sm text-muted-foreground">
                Se mantida a média, o gasto anual será de{" "}
                <span className="font-medium text-foreground">{formatBRL(annualized)}</span>.
              </p>
            )}
          </TooltipProvider>
        ) : (
          <div className="rounded-lg border border-dashed p-5 bg-muted/30 text-sm text-muted-foreground">
            Dados insuficientes para projeção confiável — são necessários ao menos 3 meses completos
            (atualmente: {result.completeCount}).
          </div>
        )}

        {chartData.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS.complete }} />
                Mês fechado
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS.partial }} />
                Mês parcial
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS.projection }} />
                Projeção
              </div>
            </div>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 24, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCompact(Number(v))} />
                  <RTooltip
                    formatter={(v: number) => formatBRL(Number(v))}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Bar dataKey="val" radius={[4, 4, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={COLORS[d.kind]}
                        strokeDasharray={d.kind === "partial" ? "4 3" : undefined}
                        stroke={d.kind === "partial" ? COLORS.complete : undefined}
                      />
                    ))}
                    <LabelList
                      dataKey="val"
                      position="top"
                      formatter={(v: number) => fmtCompact(Number(v))}
                      style={{ fontSize: 11, fill: "hsl(var(--foreground))" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {specialtyBreakdown && specialtyBreakdown.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold mb-3">Projeção por especialidade — top 10</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Especialidade</TableHead>
                    <TableHead className="text-right">Média 3M</TableHead>
                    <TableHead className="text-right">Projeção</TableHead>
                    <TableHead className="text-right">Tendência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {specialtyBreakdown.map((b) => {
                    const up = b.trendPct > 1;
                    const down = b.trendPct < -1;
                    return (
                      <TableRow key={b.spec}>
                        <TableCell className="font-medium">{b.spec}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(b.avg)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(b.proj)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span
                            className={
                              "inline-flex items-center gap-1 " +
                              (up ? "text-destructive" : down ? "text-success" : "text-muted-foreground")
                            }
                          >
                            {up ? (
                              <TrendingUp className="h-4 w-4" />
                            ) : down ? (
                              <TrendingDown className="h-4 w-4" />
                            ) : (
                              <Minus className="h-4 w-4" />
                            )}
                            {b.trendPct.toFixed(1)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};

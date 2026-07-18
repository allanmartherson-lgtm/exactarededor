import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
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
  LineChart,
  Line,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { formatBRL, mean, median } from "@/lib/financialStats";
import { toRpcTrack, type TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EXCLUDED = new Set(["rascunho", "cancelado", "rejeitado"]);

const COLORS = {
  complete: "#003DA5",
  partial: "#003DA5", // opacity 0.5 handled via fillOpacity
  projection: "#C6A27C",
};

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Math.max(0, Math.min(11, parseInt(m ?? "1", 10) - 1));
  return `${MONTHS_PT[idx]}/${(y ?? "").slice(2)}`;
}

function fmtShort(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return `R$ ${v.toFixed(0)}`;
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function nextYm(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface PaymentRow {
  competence_month: string | null;
  total_amount: number;
  status: string;
}

interface TrendRow {
  group_key: string;
  month_bucket: string;
  total: number;
}

type Grouping = "especialidade" | "empresa";
type BarKind = "complete" | "partial" | "projection";

export const TrendProjectionTab = ({ track = "all" }: { track?: TrackFilterValue } = {}) => {
  const [grouping, setGrouping] = useState<Grouping>("especialidade");
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [trendRows, setTrendRows] = useState<TrendRow[] | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [partialInfo, setPartialInfo] = useState<{ processed: number; expected: number } | null>(null);

  // Payments para gráfico + KPIs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      const cutoffDate = cutoff.toISOString().slice(0, 10);
      let pq = supabase
        .from("payments")
        .select("competence_month,total_amount,status,payment_track")
        .gte("competence_month", cutoffDate);
      if (track === "habitual" || track === "prioritario") pq = pq.eq("payment_track", track);
      else if (track === "nao_classificado") pq = pq.is("payment_track", null);

      const { data } = await pq;
      if (cancelled) return;
      const list = (data as unknown as PaymentRow[]) ?? [];
      setPayments(list);

      // parcial info do mês corrente
      const cur = currentYm();
      const monthPayments = list.filter((p) => p.competence_month?.slice(0, 7) === cur);
      const processed = monthPayments.filter((p) => !EXCLUDED.has(p.status)).length;
      const expected = monthPayments.length;
      setPartialInfo({ processed, expected });
    })();
    return () => {
      cancelled = true;
    };
  }, [track]);

  // Tendência por grupo (tabela)
  useEffect(() => {
    let cancelled = false;
    setTrendRows(null);
    setTrendError(null);
    (async () => {
      try {
        const today = new Date();
        const current = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString()
          .slice(0, 10);
        const { data, error } = await supabase.rpc("get_spend_trend", {
          p_current_month: current,
          p_months_back: 6,
          p_grouping: grouping,
          p_track: toRpcTrack(track),
        } as never);
        if (cancelled) return;
        if (error) {
          setTrendError(error.message);
          setTrendRows([]);
          return;
        }
        // "(sem empresa)" para group_key vazio quando agrupando por empresa
        const rows = ((data as TrendRow[]) ?? []).map((r) => ({
          ...r,
          group_key:
            r.group_key && r.group_key.trim()
              ? r.group_key
              : grouping === "empresa"
                ? "(sem empresa)"
                : "(sem especialidade)",
        }));
        setTrendRows(rows);
      } catch (err) {
        if (cancelled) return;
        setTrendError(err instanceof Error ? err.message : String(err));
        setTrendRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grouping, track]);

  // Deriva meses / projeção / partial
  const monthly = useMemo(() => {
    if (!payments) return null;
    const cur = currentYm();
    const map = new Map<string, number>();
    for (const r of payments) {
      if (!r.competence_month || EXCLUDED.has(r.status)) continue;
      const key = r.competence_month.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(r.total_amount));
    }
    const all = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
    const partial = all.find(([m]) => m === cur) ?? null;
    const nonCurrent = all.filter(([m]) => m !== cur);

    // meses incompletos = total < 30% da mediana
    const incomplete = new Set<string>();
    if (nonCurrent.length >= 2) {
      const med = median(nonCurrent.map(([, v]) => v));
      const th = med * 0.3;
      for (const [m, v] of nonCurrent) if (v < th) incomplete.add(m);
    }
    const completeMonths = nonCurrent.filter(([m]) => !incomplete.has(m));

    const hasProjection = completeMonths.length >= 3;
    const projection = hasProjection ? mean(completeMonths.slice(-3).map(([, v]) => v)) : 0;
    const [lastClosedYm, lastClosed] = hasProjection
      ? completeMonths[completeMonths.length - 1]
      : [null as string | null, 0];
    const delta = lastClosed > 0 ? ((projection - lastClosed) / lastClosed) * 100 : 0;

    // Barras
    const bars: Array<{ ym: string; label: string; val: number; kind: BarKind }> = [];
    for (const [m, v] of nonCurrent) {
      if (incomplete.has(m)) continue;
      bars.push({ ym: m, label: fmtMonth(m), val: v, kind: "complete" });
    }
    if (partial) bars.push({ ym: partial[0], label: fmtMonth(partial[0]), val: partial[1], kind: "partial" });
    if (hasProjection) {
      const nym = nextYm();
      bars.push({ ym: nym, label: fmtMonth(nym), val: projection, kind: "projection" });
    }

    // Projeção anualizada (ano corrente)
    const year = new Date().getFullYear();
    const curMonthNum = new Date().getMonth() + 1;
    let closedYearSum = 0;
    for (const [ym, v] of map.entries()) {
      const [y, mm] = ym.split("-");
      if (parseInt(y, 10) === year && parseInt(mm, 10) < curMonthNum) closedYearSum += v;
    }
    const monthsRemaining = 12 - (curMonthNum - 1);
    const annualized = hasProjection ? closedYearSum + projection * monthsRemaining : null;

    return {
      hasProjection,
      projection,
      lastClosedYm,
      lastClosed,
      delta,
      bars,
      completeCount: completeMonths.length,
      completeMonths: completeMonths.map(([m]) => m),
      annualized,
      partialYm: partial ? partial[0] : null,
    };
  }, [payments]);

  // Frase de insight
  const insight = useMemo(() => {
    if (!monthly?.hasProjection) return null;
    const nym = nextYm();
    const nextLabel = fmtMonth(nym);
    const proj = formatBRL(monthly.projection);
    const d = monthly.delta;
    if (d > 3) {
      return `Tendência de alta desde ${monthly.lastClosedYm ? fmtMonth(monthly.lastClosedYm) : ""}. Projeção para ${nextLabel}: ${proj} (+${d.toFixed(1)}% vs último mês).`;
    }
    if (d < -3) {
      return `Tendência de queda desde ${monthly.lastClosedYm ? fmtMonth(monthly.lastClosedYm) : ""}. Projeção para ${nextLabel}: ${proj} (${d.toFixed(1)}% vs último mês).`;
    }
    return `Tendência estável em torno de ${formatBRL(monthly.projection)} nos últimos meses. Projeção para ${nextLabel}: ${proj}.`;
  }, [monthly]);

  // Tabela de grupos com sparkline
  const groupTable = useMemo(() => {
    if (!trendRows || !monthly) return null;
    const months = Array.from(new Set(trendRows.map((r) => r.month_bucket.slice(0, 7)))).sort();
    const completeSet = new Set(monthly.completeMonths);
    const closedMonths = months.filter((m) => completeSet.has(m));
    const last3 = closedMonths.slice(-3);
    const lastClosed = closedMonths[closedMonths.length - 1] ?? null;

    const byGroup = new Map<string, Map<string, number>>();
    for (const r of trendRows) {
      const ym = r.month_bucket.slice(0, 7);
      const g = r.group_key;
      if (!byGroup.has(g)) byGroup.set(g, new Map());
      byGroup.get(g)!.set(ym, (byGroup.get(g)!.get(ym) ?? 0) + Number(r.total));
    }

    const rows = Array.from(byGroup.entries()).map(([g, mm]) => {
      const spark = months.map((m) => ({ m, v: mm.get(m) ?? 0 }));
      const last3Vals = last3.map((m) => mm.get(m) ?? 0);
      const avg3 = last3Vals.length ? mean(last3Vals) : 0;
      const lastVal = lastClosed ? mm.get(lastClosed) ?? 0 : 0;
      const trend = avg3 > 0 ? ((lastVal - avg3) / avg3) * 100 : 0;
      return { group: g, spark, avg3, lastVal, trend };
    });
    rows.sort((a, b) => b.avg3 - a.avg3);
    return rows.slice(0, 10);
  }, [trendRows, monthly]);

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <SurfaceCardHeader
          title="Tendência e Projeção"
          icon={TrendingUp}
          iconColor="blue"
          subtitle="Evolução mensal e projeção para o próximo mês"
        />
        <div className="p-6 space-y-6">
          {!monthly ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              {/* A) Insight */}
              {insight && (
                <p className="text-sm text-muted-foreground">{insight}</p>
              )}

              {/* B) Bar chart */}
              {monthly.bars.length > 0 && (
                <div>
                  <div className="flex items-center gap-4 mb-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS.complete }} />
                      Mês fechado
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-3 h-3 rounded-sm border border-dashed"
                        style={{ background: COLORS.partial, opacity: 0.5, borderColor: COLORS.complete }}
                      />
                      Parcial
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-3 h-3 rounded-sm" style={{ background: COLORS.projection }} />
                      Projeção
                    </div>
                  </div>
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={monthly.bars}
                        margin={{ top: 32, right: 16, left: 8, bottom: 24 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={(props) => {
                            const { x, y, payload, index } = props as {
                              x: number;
                              y: number;
                              payload: { value: string };
                              index: number;
                            };
                            const bar = monthly.bars[index];
                            const sub =
                              bar?.kind === "partial"
                                ? "(parcial)"
                                : bar?.kind === "projection"
                                  ? "(projeção)"
                                  : "";
                            return (
                              <g transform={`translate(${x},${y})`}>
                                <text y={12} textAnchor="middle" fontSize={11} fill="hsl(var(--foreground))">
                                  {payload.value}
                                </text>
                                {sub && (
                                  <text
                                    y={26}
                                    textAnchor="middle"
                                    fontSize={10}
                                    fill="hsl(var(--muted-foreground))"
                                  >
                                    {sub}
                                  </text>
                                )}
                              </g>
                            );
                          }}
                        />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => fmtShort(Number(v))}
                          width={70}
                        />
                        <RTooltip
                          formatter={(v: number) => formatBRL(Number(v))}
                          contentStyle={{
                            background: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                          }}
                        />
                        <Bar dataKey="val" radius={[4, 4, 0, 0]}>
                          {monthly.bars.map((d, i) => (
                            <Cell
                              key={i}
                              fill={d.kind === "projection" ? COLORS.projection : COLORS.complete}
                              fillOpacity={d.kind === "partial" ? 0.5 : 1}
                              stroke={d.kind === "partial" ? COLORS.complete : undefined}
                              strokeDasharray={d.kind === "partial" ? "4 3" : undefined}
                            />
                          ))}
                          <LabelList
                            dataKey="val"
                            position="top"
                            content={(props: Record<string, unknown>) => {
                              const idx = props.index as number;
                              const value = props.value as number | undefined;
                              const x = props.x as number;
                              const y = props.y as number;
                              const width = props.width as number;
                              if (value == null) return null;
                              const prev = idx > 0 ? monthly.bars[idx - 1].val : null;
                              const delta =
                                prev && prev > 0 ? ((value - prev) / prev) * 100 : null;
                              const color =
                                monthly.bars[idx].kind === "projection"
                                  ? COLORS.projection
                                  : COLORS.complete;
                              return (
                                <g key={`bl-${idx}`}>
                                  <text
                                    x={x + width / 2}
                                    y={y - 20}
                                    textAnchor="middle"
                                    fontSize={11}
                                    fontWeight={600}
                                    fill={color}
                                  >
                                    {fmtShort(value)}
                                  </text>
                                  {delta !== null && (
                                    <text
                                      x={x + width / 2}
                                      y={y - 6}
                                      textAnchor="middle"
                                      fontSize={9}
                                      fill={
                                        delta > 0
                                          ? "hsl(var(--destructive))"
                                          : delta < 0
                                            ? "hsl(var(--success))"
                                            : "hsl(var(--muted-foreground))"
                                      }
                                    >
                                      {delta > 0 ? `↑ +${delta.toFixed(1)}%` : delta < 0 ? `↓ ${delta.toFixed(1)}%` : "—"}
                                    </text>
                                  )}
                                </g>
                              );
                            }}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* C) KPI cards */}
              {monthly.hasProjection ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border p-5">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Projeção próximo mês
                    </p>
                    <p className="text-2xl font-light tabular-nums">{formatBRL(monthly.projection)}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Média dos 3 últimos meses fechados
                    </p>
                  </div>
                  <div className="rounded-lg border p-5">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Variação vs último completo
                    </p>
                    <p className="text-2xl font-light tabular-nums flex items-center gap-2">
                      {monthly.delta > 0 ? (
                        <ArrowUp className="h-5 w-5 text-destructive" />
                      ) : monthly.delta < 0 ? (
                        <ArrowDown className="h-5 w-5 text-success" />
                      ) : (
                        <Minus className="h-5 w-5 text-muted-foreground" />
                      )}
                      {monthly.delta.toFixed(1)}%
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Alta = gasto crescendo · Queda = economia
                    </p>
                  </div>
                  <div className="rounded-lg border p-5">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Projeção anualizada
                    </p>
                    <p className="text-2xl font-light tabular-nums">
                      {monthly.annualized !== null ? formatBRL(monthly.annualized) : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Estimativa para {new Date().getFullYear()}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-5 bg-muted/30 text-sm text-muted-foreground">
                  Dados insuficientes para projeção confiável — necessários ao menos 3 meses completos
                  (atualmente: {monthly.completeCount}).
                </div>
              )}

              {/* E) Nota sobre mês parcial */}
              {monthly.partialYm && partialInfo && partialInfo.expected > 0 && (
                <p className="text-xs text-muted-foreground italic">
                  {fmtMonth(monthly.partialYm)} é parcial — {partialInfo.processed} lote
                  {partialInfo.processed === 1 ? "" : "s"} processado
                  {partialInfo.processed === 1 ? "" : "s"} de {partialInfo.expected} esperado
                  {partialInfo.expected === 1 ? "" : "s"}. Não entra nos cálculos de projeção.
                </p>
              )}
            </>
          )}
        </div>
      </SurfaceCard>

      {/* D) Tabela por especialidade/empresa com sparklines */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Top 10 por tendência"
          icon={TrendingUp}
          iconColor="yellow"
          subtitle={`Ordenado por média dos últimos 3 meses — agrupamento por ${grouping}`}
          rightAction={
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={grouping === "especialidade" ? "default" : "outline"}
                onClick={() => setGrouping("especialidade")}
              >
                Especialidade
              </Button>
              <Button
                size="sm"
                variant={grouping === "empresa" ? "default" : "outline"}
                onClick={() => setGrouping("empresa")}
              >
                Empresa
              </Button>
            </div>
          }
        />
        <div className="p-4">
          {!trendRows ? (
            <Skeleton className="h-64 w-full" />
          ) : trendError ? (
            <p className="text-sm text-destructive text-center py-8">
              Falha ao carregar tendência: {trendError}
            </p>
          ) : !groupTable || groupTable.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sem dados no período.</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{grouping === "empresa" ? "Empresa" : "Especialidade"}</TableHead>
                    <TableHead>Evolução (6m)</TableHead>
                    <TableHead className="text-right">Média 3M</TableHead>
                    <TableHead className="text-right">Último mês</TableHead>
                    <TableHead className="text-right">Tendência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupTable.map((r) => {
                    const up = r.trend > 1;
                    const down = r.trend < -1;
                    return (
                      <TableRow key={r.group}>
                        <TableCell className="font-medium max-w-[280px] truncate" title={r.group}>
                          {r.group}
                        </TableCell>
                        <TableCell>
                          <div style={{ width: 100, height: 30 }}>
                            <ResponsiveContainer>
                              <LineChart data={r.spark} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                                <Line
                                  type="monotone"
                                  dataKey="v"
                                  stroke="#003DA5"
                                  strokeWidth={1.5}
                                  dot={false}
                                  isAnimationActive={false}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(r.avg3)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(r.lastVal)}</TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant="outline"
                            className={
                              "gap-1 " +
                              (up
                                ? "text-destructive border-destructive/40"
                                : down
                                  ? "text-success border-success/40"
                                  : "text-muted-foreground")
                            }
                          >
                            {up ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : down ? (
                              <ArrowDown className="h-3 w-3" />
                            ) : (
                              <Minus className="h-3 w-3" />
                            )}
                            {r.trend.toFixed(1)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
};

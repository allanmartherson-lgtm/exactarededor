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
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, ArrowUp, ArrowDown, Minus, Search, ClipboardList, ChevronDown, ChevronRight, CheckCircle2, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { formatBRL, mean } from "@/lib/financialStats";
import { toRpcTrack, type TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const EXCLUDED = new Set(["rascunho", "cancelado", "rejeitado"]);

const COLORS = {
  closed: "#003DA5",
  processedDark: "#003DA5",
  remaining: "#71C5E8",
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

function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentYm(): string {
  return ymOf(new Date());
}

function previousYm(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return ymOf(d);
}

interface PaymentRow {
  competence_month: string | null;
  total_amount: number;
  bruto_total: number | null;
  status: string;
}

interface BatchRow {
  pattern_name: string;
  historical_avg: number;
  historical_min: number;
  historical_max: number;
  months_present: number;
  current_amount: number | null;
  current_payment_id: string | null;
  current_reference: string | null;
  status: "recebido" | "pendente";
}

interface TrendRow {
  group_key: string;
  month_bucket: string;
  total: number;
}

type Grouping = "especialidade" | "empresa";

export const TrendProjectionTab = ({ track = "all" }: { track?: TrackFilterValue } = {}) => {
  const [grouping, setGrouping] = useState<Grouping>("especialidade");
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [trendRows, setTrendRows] = useState<TrendRow[] | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Janela de 12 meses ancorada no PRIMEIRO DIA do mês para não cortar
      // lotes do mês-limite (bug anterior: cutoff era ISO do meio do mês).
      const cutoff = new Date();
      cutoff.setDate(1);
      cutoff.setMonth(cutoff.getMonth() - 11);
      const cutoffDate = ymOf(cutoff) + "-01";
      let pq = supabase
        .from("payments")
        .select("competence_month,total_amount,status,payment_track")
        .gte("competence_month", cutoffDate);
      if (track === "habitual" || track === "prioritario") pq = pq.eq("payment_track", track);
      else if (track === "nao_classificado") pq = pq.is("payment_track", null);

      // PostgREST tem teto server-side de 1000 linhas por request que .range()
      // do client NÃO sobrescreve. Paginamos em blocos até o servidor devolver
      // um lote incompleto (mesmo padrão de MovimentacaoTab).
      const PAGE = 1000;
      const all: PaymentRow[] = [];
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await pq.range(offset, offset + PAGE - 1);
        if (error) break;
        const batch = (data as unknown as PaymentRow[]) ?? [];
        all.push(...batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
      }
      if (cancelled) return;
      setPayments(all);

    })();
    return () => {
      cancelled = true;
    };
  }, [track]);

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
        // Sem .range() o PostgREST corta em 1000 linhas — com 12 meses × N empresas
        // isso trunca grupos inteiros (bug: FISIO STAR aparecia com Fev/Abr zerados).
        // Paginação client-side em blocos de 1000 — teto server-side do PostgREST
        // não é sobrescrito por .range() alto no client. Sem isso, empresas do meio
        // do resultado perdiam meses (FISIO STAR Fev/Abr zerados).
        const PAGE = 1000;
        const all: TrendRow[] = [];
        let offset = 0;
        let rpcError: { message: string } | null = null;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const rpcBuilder = supabase.rpc("get_spend_trend", {
            p_current_month: current,
            p_months_back: 12,
            p_grouping: grouping,
            p_track: toRpcTrack(track),
          } as never) as unknown as {
            range: (a: number, b: number) => Promise<{ data: TrendRow[] | null; error: { message: string } | null }>;
          };
          const { data, error } = await rpcBuilder.range(offset, offset + PAGE - 1);
          if (error) {
            rpcError = error;
            break;
          }
          const batch = (data as TrendRow[]) ?? [];
          all.push(...batch);
          if (batch.length < PAGE) break;
          offset += PAGE;
        }
        if (cancelled) return;
        if (rpcError) {
          setTrendError(rpcError.message);
          setTrendRows([]);
          return;
        }
        const rows = all.map((r) => ({

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

  // Nova semântica de competência: hospital paga com defasagem
  // - Corrente (Jul) = ignorar
  // - Anterior (Jun) = "em processamento" (parcial)
  // - Antes disso = fechado
  const monthly = useMemo(() => {
    if (!payments) return null;
    const curYm = currentYm();
    const procYm = previousYm();
    const map = new Map<string, number>();
    for (const r of payments) {
      if (!r.competence_month || EXCLUDED.has(r.status)) continue;
      const key = r.competence_month.slice(0, 7);
      map.set(key, (map.get(key) ?? 0) + Number(r.total_amount));
    }
    const all = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));

    const closed = all.filter(([m]) => m !== curYm && m !== procYm);
    const processed = map.get(procYm) ?? 0;

    const hasProjection = closed.length >= 3;
    const projection = hasProjection ? mean(closed.slice(-3).map(([, v]) => v)) : 0;
    const [lastClosedYm, lastClosed] = closed.length
      ? closed[closed.length - 1]
      : [null as string | null, 0];
    const delta =
      hasProjection && lastClosed > 0 ? ((projection - lastClosed) / lastClosed) * 100 : 0;

    const remaining = Math.max(0, projection - processed);
    const pctProcessed = projection > 0 ? (processed / projection) * 100 : 0;

    // Barras: fechados + barra bicolor Jun (processado + restante projetado)
    const bars: Array<{
      ym: string;
      label: string;
      processed: number;
      remaining: number;
      isProcessing: boolean;
      total: number;
    }> = closed.map(([m, v]) => ({
      ym: m,
      label: fmtMonth(m),
      processed: v,
      remaining: 0,
      isProcessing: false,
      total: v,
    }));
    if (hasProjection) {
      bars.push({
        ym: procYm,
        label: fmtMonth(procYm),
        processed,
        remaining,
        isProcessing: true,
        total: processed + remaining,
      });
    } else if (processed > 0) {
      bars.push({
        ym: procYm,
        label: fmtMonth(procYm),
        processed,
        remaining: 0,
        isProcessing: true,
        total: processed,
      });
    }

    // Anualizada 2026 = fechados do ano + projeção * meses restantes (incluindo processing)
    const year = new Date().getFullYear();
    let closedYearSum = 0;
    for (const [ym, v] of closed) {
      if (parseInt(ym.split("-")[0], 10) === year) closedYearSum += v;
    }
    const closedMonthsThisYear = closed.filter(([m]) => parseInt(m.split("-")[0], 10) === year).length;
    const annualized = hasProjection ? closedYearSum + projection * (12 - closedMonthsThisYear) : null;

    return {
      hasProjection,
      projection,
      lastClosedYm,
      lastClosed,
      delta,
      bars,
      processed,
      remaining,
      pctProcessed,
      procYm,
      closedMonths: closed.map(([m]) => m),
      annualized,
    };
  }, [payments]);

  const insight = useMemo(() => {
    if (!monthly?.hasProjection) return null;
    const procLabel = fmtMonth(monthly.procYm);
    const proj = formatBRL(monthly.projection);
    const d = monthly.delta;
    const vs = monthly.lastClosedYm ? ` vs ${fmtMonth(monthly.lastClosedYm)}` : "";
    if (d > 3) return `${procLabel} deve fechar em ~${proj} — alta de ${d.toFixed(1)}%${vs}.`;
    if (d < -3) return `${procLabel} deve fechar em ~${proj} — queda de ${Math.abs(d).toFixed(1)}%${vs}.`;
    return `${procLabel} deve fechar em ~${proj} — estável${vs}.`;
  }, [monthly]);

  // Tabela: agrupa por grupo com mini bar chart, média 3M, mês em processamento vs média
  const groupTable = useMemo(() => {
    if (!trendRows || !monthly) return null;
    const months = Array.from(new Set(trendRows.map((r) => r.month_bucket.slice(0, 7)))).sort();
    const closedSet = new Set(monthly.closedMonths);
    const closedMonths = months.filter((m) => closedSet.has(m));
    const last3 = closedMonths.slice(-3);
    const lastClosed = closedMonths[closedMonths.length - 1] ?? null;
    const procYm = monthly.procYm;

    const byGroup = new Map<string, Map<string, number>>();
    for (const r of trendRows) {
      const ym = r.month_bucket.slice(0, 7);
      const g = r.group_key;
      if (!byGroup.has(g)) byGroup.set(g, new Map());
      byGroup.get(g)!.set(ym, (byGroup.get(g)!.get(ym) ?? 0) + Number(r.total));
    }

    // Últimos 5 meses fechados para o mini bar chart
    const barMonths = closedMonths.slice(-5);

    const rows = Array.from(byGroup.entries()).map(([g, mm]) => {
      const bars = barMonths.map((m) => ({ m, v: mm.get(m) ?? 0 }));
      const last3Vals = last3.map((m) => mm.get(m) ?? 0);
      const avg3 = last3Vals.length ? mean(last3Vals) : 0;
      const lastVal = lastClosed ? mm.get(lastClosed) ?? 0 : 0;
      const trend = avg3 > 0 ? ((lastVal - avg3) / avg3) * 100 : 0;
      const currentVal = mm.get(procYm) ?? 0;
      const currentVsAvg = avg3 > 0 ? ((currentVal - avg3) / avg3) * 100 : 0;
      return { group: g, bars, avg3, lastVal, trend, currentVal, currentVsAvg };
    });
    rows.sort((a, b) => b.avg3 - a.avg3);
    return rows;
  }, [trendRows, monthly]);

  const filteredTable = useMemo(() => {
    if (!groupTable) return null;
    const q = search.trim().toLowerCase();
    const list = q ? groupTable.filter((r) => r.group.toLowerCase().includes(q)) : groupTable;
    return showAll ? list : list.slice(0, 15);
  }, [groupTable, search, showAll]);

  const totalGroupCount = groupTable?.length ?? 0;
  const shownCount = filteredTable?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* A) Termômetro do mês */}
      {monthly && monthly.hasProjection && (
        <SurfaceCard>
          <div className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Termômetro do mês
                </p>
                <p className="text-lg font-medium mt-0.5">
                  Competência {fmtMonth(monthly.procYm)} — em processamento
                </p>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">
                <span className="text-foreground font-semibold">{fmtShort(monthly.processed)}</span>{" "}
                processado de{" "}
                <span className="text-foreground font-semibold">~{fmtShort(monthly.projection)}</span>{" "}
                projetado
                <span className="ml-2 text-xs">({monthly.pctProcessed.toFixed(0)}%)</span>
              </p>
            </div>
            <div className="h-3 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full transition-all"
                style={{
                  width: `${Math.min(100, monthly.pctProcessed)}%`,
                  background: COLORS.processedDark,
                }}
              />
            </div>
            {monthly.remaining > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                Faltam ~{fmtShort(monthly.remaining)} para atingir a projeção — lotes ainda não entraram
                nesta competência.
              </p>
            )}
          </div>
        </SurfaceCard>
      )}

      <SurfaceCard>
        <SurfaceCardHeader
          title="Tendência e Projeção"
          icon={TrendingUp}
          iconColor="blue"
          subtitle="Evolução mensal e projeção para o mês em processamento"
        />
        <div className="p-6 space-y-6">
          {!monthly ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              {insight && <p className="text-sm text-muted-foreground">{insight}</p>}

              {/* B) Bar chart — fechados + barra bicolor do mês em processamento */}
              {monthly.bars.length > 0 && (
                <div style={{ width: "100%", height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={monthly.bars}
                      margin={{ top: 36, right: 16, left: 8, bottom: 24 }}
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
                          const sub = bar?.isProcessing ? "(em processamento)" : "";
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
                        formatter={(v: number, name: string) => [
                          formatBRL(Number(v)),
                          name === "processed" ? "Processado" : "Restante projetado",
                        ]}
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                        }}
                      />
                      <Bar dataKey="processed" stackId="v" radius={[0, 0, 0, 0]}>
                        {monthly.bars.map((d, i) => (
                          <Cell
                            key={i}
                            fill={COLORS.processedDark}
                            radius={d.remaining > 0 ? 0 : 4}
                          />
                        ))}
                      </Bar>
                      <Bar dataKey="remaining" stackId="v" radius={[4, 4, 0, 0]}>
                        {monthly.bars.map((d, i) => (
                          <Cell
                            key={i}
                            fill={COLORS.remaining}
                            fillOpacity={0.55}
                            stroke={COLORS.processedDark}
                            strokeDasharray="4 3"
                          />
                        ))}
                        <LabelList
                          dataKey="total"
                          position="top"
                          content={(props: Record<string, unknown>) => {
                            const idx = props.index as number;
                            const value = props.value as number | undefined;
                            const x = props.x as number;
                            const y = props.y as number;
                            const width = props.width as number;
                            if (value == null) return null;
                            const bar = monthly.bars[idx];
                            let deltaLabel: string | null = null;
                            let deltaColor = "hsl(var(--muted-foreground))";
                            if (bar.isProcessing) {
                              // vs projeção: já é a projeção; mostrar só o total
                            } else if (idx > 0) {
                              const prev = monthly.bars[idx - 1].total;
                              if (prev > 0) {
                                const d = ((value - prev) / prev) * 100;
                                deltaLabel =
                                  d > 0 ? `↑ +${d.toFixed(1)}%` : d < 0 ? `↓ ${d.toFixed(1)}%` : "—";
                                deltaColor =
                                  d > 0
                                    ? "hsl(var(--destructive))"
                                    : d < 0
                                      ? "hsl(var(--success))"
                                      : "hsl(var(--muted-foreground))";
                              }
                            }
                            return (
                              <g key={`bl-${idx}`}>
                                <text
                                  x={x + width / 2}
                                  y={y - 20}
                                  textAnchor="middle"
                                  fontSize={11}
                                  fontWeight={600}
                                  fill={COLORS.processedDark}
                                >
                                  {fmtShort(value)}
                                </text>
                                {deltaLabel && (
                                  <text
                                    x={x + width / 2}
                                    y={y - 6}
                                    textAnchor="middle"
                                    fontSize={9}
                                    fill={deltaColor}
                                  >
                                    {deltaLabel}
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
              )}

              {/* C) KPI cards */}
              {monthly.hasProjection ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border p-5">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Projeção {fmtMonth(monthly.procYm)}
                    </p>
                    <p className="text-2xl font-light tabular-nums">{formatBRL(monthly.projection)}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Média dos 3 últimos fechados
                    </p>
                  </div>
                  <div className="rounded-lg border p-5">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Já processado
                    </p>
                    <p className="text-2xl font-light tabular-nums">{formatBRL(monthly.processed)}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {monthly.pctProcessed.toFixed(0)}% do projetado
                    </p>
                  </div>
                  <div className="rounded-lg border p-5">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
                      Projeção anual {new Date().getFullYear()}
                    </p>
                    <p className="text-2xl font-light tabular-nums">
                      {monthly.annualized !== null ? formatBRL(monthly.annualized) : "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Fechados + projeção nos meses restantes
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-5 bg-muted/30 text-sm text-muted-foreground">
                  Dados insuficientes para projeção confiável — necessários ao menos 3 meses fechados.
                </div>
              )}
            </>
          )}
        </div>
      </SurfaceCard>

      {/* D) Tabela com mini bar charts e busca */}
      <SurfaceCard>
        <SurfaceCardHeader
          title={`Top ${grouping === "empresa" ? "empresas" : "especialidades"}`}
          icon={TrendingUp}
          iconColor="yellow"
          subtitle="Ordenado por média dos 3 últimos meses fechados"
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
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={`Buscar ${grouping === "empresa" ? "empresa" : "especialidade"}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9"
              />
            </div>
            {totalGroupCount > 15 && (
              <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Mostrar top 15" : `Ver todas (${totalGroupCount})`}
              </Button>
            )}
          </div>

          {!trendRows ? (
            <Skeleton className="h-64 w-full" />
          ) : trendError ? (
            <p className="text-sm text-destructive text-center py-8">
              Falha ao carregar tendência: {trendError}
            </p>
          ) : !filteredTable || filteredTable.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {search ? "Nenhum resultado para a busca." : "Sem dados no período."}
            </p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{grouping === "empresa" ? "Empresa" : "Especialidade"}</TableHead>
                    <TableHead>Evolução</TableHead>
                    <TableHead className="text-right">Média 3M</TableHead>
                    <TableHead className="text-right">Mês atual</TableHead>
                    <TableHead className="text-right">Tendência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTable.map((r) => {
                    const up = r.trend > 1;
                    const down = r.trend < -1;
                    const curUp = r.currentVsAvg > 1;
                    const curDown = r.currentVsAvg < -1;
                    const maxBar = Math.max(1, ...r.bars.map((b) => b.v));
                    return (
                      <TableRow
                        key={r.group}
                        className="cursor-pointer hover:bg-muted/40"
                        onClick={() => setSelectedGroup(r.group)}
                      >
                        <TableCell className="font-medium max-w-[280px] truncate" title={r.group}>
                          {r.group}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-end gap-[3px]" style={{ width: 120, height: 32 }}>
                            {r.bars.map((b, i) => {
                              const h = maxBar > 0 ? (b.v / maxBar) * 100 : 0;
                              return (
                                <div
                                  key={i}
                                  className="flex-1 rounded-sm"
                                  style={{
                                    height: `${Math.max(4, h)}%`,
                                    background: COLORS.closed,
                                    opacity: b.v === 0 ? 0.15 : 0.85,
                                  }}
                                  title={`${fmtMonth(b.m)}: ${formatBRL(b.v)}`}
                                />
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(r.avg3)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div className="flex items-center justify-end gap-1.5">
                            <span>{formatBRL(r.currentVal)}</span>
                            {r.avg3 > 0 && (
                              <span
                                className={
                                  "text-[10px] " +
                                  (curUp
                                    ? "text-destructive"
                                    : curDown
                                      ? "text-success"
                                      : "text-muted-foreground")
                                }
                              >
                                {curUp ? "↑" : curDown ? "↓" : "="}
                                {Math.abs(r.currentVsAvg).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </TableCell>
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

      <GroupDetailSheet
        group={selectedGroup}
        grouping={grouping}
        procYm={monthly?.procYm ?? null}
        closedMonths={monthly?.closedMonths ?? []}
        row={groupTable?.find((r) => r.group === selectedGroup) ?? null}
        onClose={() => setSelectedGroup(null)}
        track={track}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Sheet de detalhe do grupo (bar chart 5m + top 5 médicos)
// ─────────────────────────────────────────────────────────────
interface GroupRow {
  group: string;
  bars: Array<{ m: string; v: number }>;
  avg3: number;
  currentVal: number;
}

const GroupDetailSheet = ({
  group,
  grouping,
  procYm,
  row,
  onClose,
  track,
}: {
  group: string | null;
  grouping: Grouping;
  procYm: string | null;
  closedMonths: string[];
  row: GroupRow | null;
  onClose: () => void;
  track: TrackFilterValue;
}) => {
  const [topDoctors, setTopDoctors] = useState<Array<{ name: string; value: number }> | null>(null);

  useEffect(() => {
    if (!group || !procYm) {
      setTopDoctors(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setTopDoctors(null);
      const startDate = `${procYm}-01`;
      const [y, m] = procYm.split("-").map((n) => parseInt(n, 10));
      const endD = new Date(y, m, 1);
      const endDate = endD.toISOString().slice(0, 10);

      // payment_items NÃO tem competence_month — está em payments.
      // Buscamos os IDs de payments da competência e filtramos os itens por payment_id.
      const { data: pays } = await supabase
        .from("payments")
        .select("id")
        .gte("competence_month", startDate)
        .lt("competence_month", endDate);
      if (cancelled) return;
      const paymentIds = (pays ?? []).map((p: { id: string }) => p.id);
      if (paymentIds.length === 0) {
        setTopDoctors([]);
        return;
      }

      let q = supabase
        .from("payment_items")
        .select("doctor_name,gross_amount,specialty,company_name")
        .in("payment_id", paymentIds);

      if (grouping === "especialidade") q = q.eq("specialty", group);
      else q = q.eq("company_name", group);

      const { data } = await q.limit(10000);
      if (cancelled) return;
      const agg = new Map<string, number>();
      for (const it of (data ?? []) as unknown as Array<{ doctor_name: string | null; gross_amount: number | null }>) {
        const name = it.doctor_name?.trim() || "(sem médico)";
        agg.set(name, (agg.get(name) ?? 0) + Number(it.gross_amount ?? 0));
      }
      const top = Array.from(agg.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
      setTopDoctors(top);
    })();
    return () => {
      cancelled = true;
    };
  }, [group, grouping, procYm, track]);

  const chartData = useMemo(() => {
    if (!row) return [];
    return row.bars.map((b) => ({ label: fmtMonth(b.m), val: b.v }));
  }, [row]);

  return (
    <Sheet open={!!group} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="pr-8">{group ?? ""}</SheetTitle>
          <SheetDescription>
            Detalhamento — {grouping === "empresa" ? "empresa" : "especialidade"}
          </SheetDescription>
        </SheetHeader>

        {row && (
          <div className="mt-6 space-y-6">
            <div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] uppercase text-muted-foreground font-semibold">
                    Processado {procYm ? fmtMonth(procYm) : ""}
                  </p>
                  <p className="text-lg font-light tabular-nums mt-1">{formatBRL(row.currentVal)}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-[10px] uppercase text-muted-foreground font-semibold">Média 3M</p>
                  <p className="text-lg font-light tabular-nums mt-1">{formatBRL(row.avg3)}</p>
                </div>
              </div>

              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Evolução (últimos meses fechados)
              </p>
              <div style={{ width: "100%", height: 180 }}>
                <ResponsiveContainer>
                  <BarChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtShort(Number(v))} width={60} />
                    <RTooltip
                      formatter={(v: number) => formatBRL(Number(v))}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    />
                    <Bar dataKey="val" fill={COLORS.closed} radius={[3, 3, 0, 0]}>
                      <LabelList
                        dataKey="val"
                        position="top"
                        formatter={(v: number) => fmtShort(Number(v))}
                        style={{ fontSize: 10, fill: COLORS.closed, fontWeight: 600 }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                Top 5 médicos — {procYm ? fmtMonth(procYm) : ""}
              </p>
              {topDoctors === null ? (
                <Skeleton className="h-24 w-full" />
              ) : topDoctors.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">Sem lançamentos processados nesta competência.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {topDoctors.map((d) => (
                    <li key={d.name} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="truncate pr-2" title={d.name}>{d.name}</span>
                      <span className="tabular-nums text-muted-foreground">{formatBRL(d.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

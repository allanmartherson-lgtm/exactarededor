import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import { Calculator, ArrowDown, ArrowUp, Minus, Info } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBRL, mean, median } from "@/lib/financialStats";
import type { TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

interface PaymentRow {
  competence_month: string | null;
  total_amount: number;
  status: string;
}

interface ItemRow {
  sector: string | null;
  gross_amount: number | null;
  created_at: string;
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

export const ProjectionTab = ({ track = "all" }: { track?: TrackFilterValue } = {}) => {
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [items, setItems] = useState<ItemRow[] | null>(null);
  const [sectorMap, setSectorMap] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    (async () => {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - 6);
      let pq = supabase
        .from("payments")
        .select("competence_month,total_amount,status,payment_track")
        .gte("competence_month", cutoff.toISOString().slice(0, 10));
      let iq = supabase
        .from("payment_items")
        .select("sector, gross_amount, created_at, payments!inner(payment_track)")
        .gte("created_at", cutoff.toISOString())
        .not("gross_amount", "is", null)
        .limit(20000);
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

    // Detect incomplete months: total < 30% of median of the others
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
    };
  }, [rows]);

  const breakdown = useMemo(() => {
    if (!items || !sectorMap) return null;
    const byCat = new Map<string, number>();
    let total = 0;
    for (const it of items) {
      const v = Number(it.gross_amount) || 0;
      if (v <= 0) continue;
      const slug = it.sector?.trim();
      const cat = (slug && sectorMap.get(slug)) || "(sem setor)";
      byCat.set(cat, (byCat.get(cat) ?? 0) + v);
      total += v;
    }
    const projection = result?.hasProjection ? result.projection : 0;
    return Array.from(byCat.entries())
      .map(([cat, val]) => ({
        cat,
        val,
        pct: total > 0 ? (val / total) * 100 : 0,
        proj: total > 0 ? (val / total) * projection : 0,
      }))
      .sort((a, b) => b.val - a.val);
  }, [items, sectorMap, result]);

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
          </TooltipProvider>
        ) : (
          <div className="rounded-lg border border-dashed p-5 bg-muted/30 text-sm text-muted-foreground">
            Dados insuficientes para projeção confiável — são necessários ao menos 3 meses completos
            (atualmente: {result.completeCount}).
          </div>
        )}
        {result && (result.monthsWithFlag.length > 0 || result.partial) && (
          <div className="mt-6 grid grid-cols-3 sm:grid-cols-6 gap-2">
            {result.monthsWithFlag.map((m) => {
              const isIncomplete = m.flag === "incompleto";
              return (
                <div
                  key={m.ym}
                  className={
                    isIncomplete
                      ? "rounded border border-dashed p-3 text-center bg-muted/40"
                      : "rounded border p-3 text-center"
                  }
                  title={isIncomplete ? "Mês incompleto — não entra nos cálculos" : undefined}
                >
                  <p className="text-xs text-muted-foreground">
                    {fmtMonth(m.ym)}
                    {isIncomplete && <span className="italic"> (incompleto)</span>}
                  </p>
                  <p
                    className={
                      isIncomplete
                        ? "text-sm font-medium tabular-nums mt-1 text-muted-foreground"
                        : "text-sm font-medium tabular-nums mt-1"
                    }
                  >
                    {formatBRL(m.val)}
                  </p>
                </div>
              );
            })}
            {result.partial && (
              <div
                key={result.partial[0]}
                className="rounded border border-dashed p-3 text-center bg-muted/40"
                title="Mês em andamento — não entra nos cálculos"
              >
                <p className="text-xs text-muted-foreground">
                  {fmtMonth(result.partial[0])} <span className="italic">(parcial)</span>
                </p>
                <p className="text-sm font-medium tabular-nums mt-1 text-muted-foreground">
                  {formatBRL(result.partial[1])}
                </p>
              </div>
            )}
          </div>
        )}

        {breakdown && breakdown.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold mb-3">Projeção por tipo de procedimento</h3>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Total histórico (6m)</TableHead>
                    <TableHead className="text-right">% do total</TableHead>
                    {result?.hasProjection && (
                      <TableHead className="text-right">Projeção estimada</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {breakdown.map((b) => (
                    <TableRow key={b.cat}>
                      <TableCell className="font-medium">{b.cat}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBRL(b.val)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {b.pct.toFixed(1)}%
                      </TableCell>
                      {result?.hasProjection && (
                        <TableCell className="text-right tabular-nums">{formatBRL(b.proj)}</TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
};

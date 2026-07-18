import { useEffect, useMemo, useState, Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SurfaceCard, SurfaceCardHeader } from "@/components/shared/SurfacePrimitives";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  Minus,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/financialStats";
import { toRpcTrack, type TrackFilterValue } from "@/components/shared/PaymentTrackFilter";

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function fmtMonth(ym: string): string {
  const [y, m] = ym.split("-");
  const idx = Math.max(0, Math.min(11, parseInt(m ?? "1", 10) - 1));
  return `${MONTHS_PT[idx]}/${(y ?? "").slice(2)}`;
}

function fmtShort(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}R$ ${abs.toFixed(0)}`;
}

function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface TrendRow {
  group_key: string;
  month_bucket: string;
  total: number;
}

type Grouping = "especialidade" | "empresa";
type SortKey = "name" | "share" | "avg3" | "last" | "delta";

interface GroupStats {
  name: string;
  months: Map<string, number>; // ym -> total
  values5: { ym: string; value: number }[]; // últimos 5 (fechado + parcial + anteriores)
  closedValues: { ym: string; value: number }[]; // apenas fechados
  last: number; // último fechado
  lastYm: string | null;
  avg3: number; // média 3 fechados anteriores ao "last"
  totalWindow: number; // soma na janela (para participação)
  deltaPct: number; // last vs avg3 (%)
  deltaAbs: number; // last - avg3
}

const orderedMonths = (n: number): string[] => {
  // Meses fechados: current - 2, current - 3, ... (últimos n meses fechados)
  const today = new Date();
  today.setDate(1);
  today.setMonth(today.getMonth() - 2);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push(ymOf(d));
  }
  return out.reverse(); // do mais antigo para o mais recente
};

export const MovimentacaoTab = ({ track = "all" }: { track?: TrackFilterValue } = {}) => {
  const [grouping, setGrouping] = useState<Grouping>("empresa");
  const [rows, setRows] = useState<TrendRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("avg3");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const today = new Date();
        const current = new Date(today.getFullYear(), today.getMonth(), 1)
          .toISOString()
          .slice(0, 10);
        const rpcBuilder = supabase.rpc("get_spend_trend", {
          p_current_month: current,
          p_months_back: 8,
          p_grouping: grouping,
          p_track: toRpcTrack(track),
        } as never) as unknown as {
          range: (
            a: number,
            b: number,
          ) => Promise<{ data: TrendRow[] | null; error: { message: string } | null }>;
        };
        const { data, error } = await rpcBuilder.range(0, 49999);
        if (cancelled) return;
        if (error) {
          setError(error.message);
          setRows([]);
          return;
        }
        const mapped = ((data as TrendRow[]) ?? []).map((r) => ({
          ...r,
          group_key:
            r.group_key && r.group_key.trim()
              ? r.group_key
              : grouping === "empresa"
                ? "(sem empresa)"
                : "(sem especialidade)",
        }));
        setRows(mapped);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grouping, track]);

  const window5 = useMemo(() => orderedMonths(5), []);
  const closedYms = useMemo(() => orderedMonths(4), []); // fechados usados para avg3 + last
  const lastClosedYm = closedYms[closedYms.length - 1];

  const stats = useMemo<GroupStats[] | null>(() => {
    if (!rows) return null;
    const byGroup = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const g = r.group_key;
      if (!byGroup.has(g)) byGroup.set(g, new Map());
      const m = byGroup.get(g)!;
      const ym = String(r.month_bucket).slice(0, 7);
      m.set(ym, (m.get(ym) ?? 0) + Number(r.total));
    }

    const out: GroupStats[] = [];
    for (const [name, months] of byGroup) {
      const values5 = window5.map((ym) => ({ ym, value: months.get(ym) ?? 0 }));
      const closedValues = closedYms.map((ym) => ({ ym, value: months.get(ym) ?? 0 }));
      const last = closedValues[closedValues.length - 1]?.value ?? 0;
      const prev3 = closedValues.slice(0, -1).map((c) => c.value);
      const avg3 = prev3.length ? prev3.reduce((a, b) => a + b, 0) / prev3.length : 0;
      const totalWindow = closedValues.reduce((a, b) => a + b.value, 0);
      const deltaAbs = last - avg3;
      const deltaPct = avg3 > 0 ? (deltaAbs / avg3) * 100 : last > 0 ? Infinity : 0;
      out.push({
        name,
        months,
        values5,
        closedValues,
        last,
        lastYm: closedValues[closedValues.length - 1]?.ym ?? null,
        avg3,
        totalWindow,
        deltaAbs,
        deltaPct,
      });
    }
    return out;
  }, [rows, window5, closedYms]);

  const grandTotal = useMemo(() => {
    if (!stats) return 0;
    return stats.reduce((a, b) => a + b.totalWindow, 0);
  }, [stats]);

  const alerts = useMemo(() => {
    if (!stats) return [];
    return stats
      .filter((s) => s.avg3 > 0 && s.deltaAbs > 0 && s.deltaPct >= 50)
      .sort((a, b) => b.deltaAbs - a.deltaAbs)
      .slice(0, 5);
  }, [stats]);

  const movers = useMemo(() => {
    if (!stats) return { ups: [] as GroupStats[], downs: [] as GroupStats[] };
    const withDelta = stats.filter((s) => s.avg3 > 0 || s.last > 0);
    const ups = withDelta
      .filter((s) => s.deltaAbs > 0)
      .sort((a, b) => b.deltaAbs - a.deltaAbs)
      .slice(0, 5);
    const downs = withDelta
      .filter((s) => s.deltaAbs < 0)
      .sort((a, b) => a.deltaAbs - b.deltaAbs)
      .slice(0, 5);
    return { ups, downs };
  }, [stats]);

  const tableRows = useMemo(() => {
    if (!stats) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? stats.filter((s) => s.name.toLowerCase().includes(q))
      : stats.slice();
    filtered.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name, "pt-BR") * dir;
        case "share":
          return (a.totalWindow - b.totalWindow) * dir;
        case "avg3":
          return (a.avg3 - b.avg3) * dir;
        case "last":
          return (a.last - b.last) * dir;
        case "delta":
          return (a.deltaAbs - b.deltaAbs) * dir;
      }
    });
    return showAll ? filtered : filtered.slice(0, 15);
  }, [stats, search, sortKey, sortDir, showAll]);

  const totalCount = stats?.length ?? 0;

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const SortHeader = ({ label, k, className }: { label: string; k: SortKey; className?: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(k)}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground transition-colors",
        sortKey === k && "text-foreground font-semibold",
        className,
      )}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  );

  const lastLabel = lastClosedYm ? fmtMonth(lastClosedYm) : "-";

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Participação e Movimentação"
        icon={Activity}
        iconColor="red"
        subtitle={`Quem representa mais, quem subiu e quem caiu — comparando ${lastLabel} vs média dos 3 meses anteriores`}
        actions={
          <div className="inline-flex rounded-md border p-1 bg-muted/40">
            {(["empresa", "especialidade"] as Grouping[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGrouping(g);
                  setExpanded(null);
                  setShowAll(false);
                }}
                className={cn(
                  "px-3 py-1 text-xs rounded font-medium transition-colors capitalize",
                  grouping === g
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {g === "empresa" ? "Empresa" : "Especialidade"}
              </button>
            ))}
          </div>
        }
      />
      <div className="p-4 space-y-5">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {!stats ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            {/* A) Alertas de movimentação */}
            {alerts.length > 0 && (
              <div
                className="rounded-lg border border-destructive/30 p-4 space-y-3"
                style={{ background: "hsl(var(--destructive) / 0.05)" }}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-semibold text-foreground">
                    {alerts.length} {alerts.length === 1 ? grouping === "empresa" ? "empresa" : "especialidade" : grouping === "empresa" ? "empresas" : "especialidades"} com movimentação anormal em {lastLabel}
                  </span>
                </div>
                <ul className="space-y-1.5 text-sm">
                  {alerts.map((a) => {
                    const isHigh = a.deltaPct >= 200 || !isFinite(a.deltaPct);
                    return (
                      <li key={a.name} className="flex items-center gap-2 flex-wrap">
                        <span className={cn("h-2 w-2 rounded-full", isHigh ? "bg-destructive" : "bg-amber-500")} />
                        <span className="font-medium text-foreground">{a.name}:</span>
                        <span className="tabular-nums">{formatBRL(a.last)}</span>
                        <span className={cn("text-xs tabular-nums", isHigh ? "text-destructive" : "text-amber-700")}>
                          {isFinite(a.deltaPct) ? `(+${a.deltaPct.toFixed(0)}%` : "(novo"}
                          {a.avg3 > 0 && ` vs média ${formatBRL(a.avg3)}`})
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* B) Tabela top */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={grouping === "empresa" ? "Buscar empresa..." : "Buscar especialidade..."}
                    className="pl-7 h-8 text-sm"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  Exibindo {tableRows.length} de {totalCount}
                </div>
              </div>

              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>
                        <SortHeader label={grouping === "empresa" ? "Empresa" : "Especialidade"} k="name" />
                      </TableHead>
                      <TableHead className="text-right">
                        <SortHeader label="Participação" k="share" className="justify-end w-full" />
                      </TableHead>
                      <TableHead className="text-right">
                        <SortHeader label="Média 3M" k="avg3" className="justify-end w-full" />
                      </TableHead>
                      <TableHead className="text-right">
                        <SortHeader label={`Último (${lastLabel})`} k="last" className="justify-end w-full" />
                      </TableHead>
                      <TableHead className="text-right">
                        <SortHeader label="Variação" k="delta" className="justify-end w-full" />
                      </TableHead>
                      <TableHead className="text-center w-[120px]">Evolução</TableHead>
                      <TableHead className="w-6" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tableRows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-8">
                          Nenhum resultado.
                        </TableCell>
                      </TableRow>
                    ) : (
                      tableRows.map((s, i) => {
                        const share = grandTotal > 0 ? (s.totalWindow / grandTotal) * 100 : 0;
                        const isOpen = expanded === s.name;
                        return (
                          <Fragment key={s.name}>
                            <TableRow
                              className="cursor-pointer hover:bg-muted/40"
                              onClick={() => setExpanded(isOpen ? null : s.name)}
                            >
                              <TableCell className="text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                              <TableCell className="font-medium">{s.name}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {share.toFixed(1)}%
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {formatBRL(s.avg3)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-medium">
                                {formatBRL(s.last)}
                              </TableCell>
                              <TableCell className="text-right">
                                <DeltaBadge deltaAbs={s.deltaAbs} deltaPct={s.deltaPct} avg3={s.avg3} />
                              </TableCell>
                              <TableCell>
                                <MiniBars values={s.values5.map((v) => v.value)} />
                              </TableCell>
                              <TableCell>
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 text-muted-foreground transition-transform",
                                    isOpen && "rotate-90",
                                  )}
                                />
                              </TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow className="bg-muted/20 hover:bg-muted/20">
                                <TableCell colSpan={8} className="py-3">
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                                    {s.values5.map((v) => (
                                      <div key={v.ym} className="rounded border bg-background px-2 py-1.5">
                                        <div className="text-[10px] text-muted-foreground uppercase">
                                          {fmtMonth(v.ym)}
                                        </div>
                                        <div className="tabular-nums font-medium text-foreground">
                                          {formatBRL(v.value)}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {totalCount > 15 && (
                <div className="flex justify-center">
                  <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Mostrar top 15" : `Ver todas (${totalCount})`}
                  </Button>
                </div>
              )}
            </div>

            {/* C) Maiores altas x quedas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MoversCard
                title="Maiores altas"
                icon={<TrendingUp className="h-4 w-4 text-destructive" />}
                empty="Nenhuma alta significativa"
                items={movers.ups}
                tone="up"
              />
              <MoversCard
                title="Maiores quedas"
                icon={<TrendingDown className="h-4 w-4 text-emerald-600" />}
                empty="Nenhuma queda significativa"
                items={movers.downs}
                tone="down"
              />
            </div>
          </>
        )}
      </div>
    </SurfaceCard>
  );
};

const DeltaBadge = ({
  deltaAbs,
  deltaPct,
  avg3,
}: {
  deltaAbs: number;
  deltaPct: number;
  avg3: number;
}) => {
  if (avg3 === 0 && deltaAbs === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (avg3 === 0) {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/5">
        <ArrowUp className="h-3 w-3 mr-0.5" />
        novo
      </Badge>
    );
  }
  const abs = Math.abs(deltaPct);
  if (abs < 1) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Minus className="h-3 w-3 mr-0.5" />
        estável
      </Badge>
    );
  }
  const up = deltaAbs > 0;
  return (
    <Badge
      variant="outline"
      className={cn(
        "tabular-nums",
        up
          ? "border-destructive/40 text-destructive bg-destructive/5"
          : "border-emerald-500/40 text-emerald-700 bg-emerald-50",
      )}
    >
      {up ? <ArrowUp className="h-3 w-3 mr-0.5" /> : <ArrowDown className="h-3 w-3 mr-0.5" />}
      {abs.toFixed(0)}%
    </Badge>
  );
};

const MiniBars = ({ values }: { values: number[] }) => {
  const max = Math.max(1, ...values.map((v) => Math.abs(v)));
  return (
    <div className="flex items-end justify-center gap-0.5 h-7 w-[100px] mx-auto">
      {values.map((v, i) => {
        const h = max > 0 ? Math.max(2, Math.round((v / max) * 26)) : 2;
        return (
          <div
            key={i}
            className="w-3 rounded-sm bg-primary/70"
            style={{ height: `${h}px` }}
            title={fmtShort(v)}
          />
        );
      })}
    </div>
  );
};

const MoversCard = ({
  title,
  icon,
  items,
  empty,
  tone,
}: {
  title: string;
  icon: React.ReactNode;
  items: GroupStats[];
  empty: string;
  tone: "up" | "down";
}) => (
  <div className="rounded-lg border p-4 space-y-3">
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-sm font-semibold">{title}</span>
    </div>
    {items.length === 0 ? (
      <p className="text-xs text-muted-foreground py-4 text-center">{empty}</p>
    ) : (
      <ul className="space-y-2">
        {items.map((s) => (
          <li key={s.name} className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{s.name}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatBRL(s.last)} · média {formatBRL(s.avg3)}
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "tabular-nums shrink-0",
                tone === "up"
                  ? "border-destructive/40 text-destructive bg-destructive/5"
                  : "border-emerald-500/40 text-emerald-700 bg-emerald-50",
              )}
            >
              {tone === "up" ? "+" : ""}
              {fmtShort(s.deltaAbs)}
              {isFinite(s.deltaPct) && s.deltaPct !== 0 && (
                <span className="ml-1 opacity-80">
                  ({tone === "up" ? "+" : ""}
                  {s.deltaPct.toFixed(0)}%)
                </span>
              )}
            </Badge>
          </li>
        ))}
      </ul>
    )}
  </div>
);

import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/ui/KpiCard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TrendingUp, ChevronRight, ChevronDown, ExternalLink, Download } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useHospital } from "@/contexts/HospitalContext";
import { cn } from "@/lib/utils";

type Mode = "competencia" | "caixa";
type Window = "6m" | "12m" | "ytd";

interface PaymentRow {
  id: string;
  reference: string | null;
  status: string;
  cost_center_code: string | null;
  competence_month: string | null;
  approved_at: string | null;
  updated_at: string;
  liquido_total: number | null;
  bruto_total: number | null;
  total_amount: number | null;
}

interface CcMeta {
  code: string;
  level1?: string;
  level2?: string;
  level3?: string;
  level4?: string;
  level5?: string;
}

interface CompanyGroupRow {
  id: string;
  payment_id: string;
  company_id: string | null;
  company_name: string;
  liquido_total: number | null;
  bruto_total: number | null;
  total_amount: number | null;
  status: string;
}

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const BRL2 = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const PCT = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => {
  const [y, m] = key.split("-");
  const dt = new Date(Number(y), Number(m) - 1, 1);
  return dt.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");
};

function buildMonthRange(window: Window): string[] {
  const now = new Date();
  const months: string[] = [];
  if (window === "ytd") {
    for (let m = 0; m <= now.getMonth(); m++) {
      months.push(monthKey(new Date(now.getFullYear(), m, 1)));
    }
    return months;
  }
  const count = window === "6m" ? 6 : 12;
  for (let i = count - 1; i >= 0; i--) {
    months.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  }
  return months;
}

const PALETTE = ["#2563eb", "#16a34a", "#ea580c", "#9333ea", "#0891b2", "#db2777", "#65a30d"];

export default function PaymentEvolution() {
  const { hospital } = useHospital();
  const [mode, setMode] = useState<Mode>("competencia");
  const [window, setWindow] = useState<Window>("6m");
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [ccMeta, setCcMeta] = useState<Record<string, CcMeta>>({});
  const [expandedCc, setExpandedCc] = useState<string | null>(null);
  const [drillCompanies, setDrillCompanies] = useState<Record<string, CompanyGroupRow[]>>({});
  const [drillLoading, setDrillLoading] = useState(false);
  const [dialogCc, setDialogCc] = useState<{ code: string; month: string } | null>(null);

  const months = useMemo(() => buildMonthRange(window), [window]);
  const firstMonth = months[0];

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!hospital?.id) return;
      setLoading(true);
      const fromDate = `${firstMonth}-01`;
      // Pull payments with either competence_month or approved/updated within window.
      let query = supabase
        .from("payments")
        .select(
          "id,reference,status,cost_center_code,competence_month,approved_at,updated_at,liquido_total,bruto_total,total_amount",
        )
        .eq("hospital_id", hospital.id)
        .neq("status", "cancelado")
        .limit(5000);

      if (mode === "competencia") {
        query = query.gte("competence_month", fromDate);
      } else {
        // caixa: prefer approved_at, fallback updated_at; filter only "pago"
        query = query.eq("status", "pago").gte("updated_at", `${fromDate}T00:00:00`);
      }
      const { data, error } = await query;
      if (cancel) return;
      if (error) {
        console.error("[PaymentEvolution] payments error", error);
        setPayments([]);
      } else {
        setPayments((data ?? []) as PaymentRow[]);
      }

      const codes = Array.from(
        new Set((data ?? []).map((p: any) => p.cost_center_code).filter(Boolean)),
      ) as string[];
      if (codes.length > 0) {
        const { data: ccs } = await supabase
          .from("cost_centers")
          .select("code,code_p12,level1,level2,level3,level4,level5")
          .or(`code.in.(${codes.map((c) => `"${c}"`).join(",")}),code_p12.in.(${codes.map((c) => `"${c}"`).join(",")})`);
        const meta: Record<string, CcMeta> = {};
        (ccs ?? []).forEach((c: any) => {
          const key = c.code_p12 ?? c.code;
          if (key) meta[key] = c;
          if (c.code) meta[c.code] = c;
        });
        if (!cancel) setCcMeta(meta);
      } else {
        setCcMeta({});
      }
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [hospital?.id, mode, firstMonth]);

  const ccDisplay = (code: string | null) => {
    if (!code) return { label: "Sem CC", sub: "—" };
    const m = ccMeta[code];
    if (!m) return { label: code, sub: "—" };
    const sub = [m.level1, m.level2, m.level3].filter(Boolean).join(" › ");
    return { label: m.level5 || m.level4 || m.level3 || code, sub: sub || code };
  };

  // Bucket payments → cost center × month
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, number>>(); // cc → month → value
    const ccTotals = new Map<string, number>();
    payments.forEach((p) => {
      const cc = p.cost_center_code ?? "—";
      let dateStr: string | null;
      if (mode === "competencia") dateStr = p.competence_month;
      else dateStr = p.approved_at?.slice(0, 10) ?? p.updated_at.slice(0, 10);
      if (!dateStr) return;
      const mk = dateStr.slice(0, 7);
      if (!months.includes(mk)) return;
      const v = p.liquido_total ?? p.bruto_total ?? p.total_amount ?? 0;
      if (!map.has(cc)) map.set(cc, new Map());
      const row = map.get(cc)!;
      row.set(mk, (row.get(mk) ?? 0) + v);
      ccTotals.set(cc, (ccTotals.get(cc) ?? 0) + v);
    });
    const rows = Array.from(map.entries())
      .map(([cc, row]) => ({
        cc,
        total: ccTotals.get(cc) ?? 0,
        byMonth: months.map((m) => row.get(m) ?? 0),
      }))
      .sort((a, b) => b.total - a.total);
    return rows;
  }, [payments, months, mode]);

  // KPIs
  const grandTotal = matrix.reduce((s, r) => s + r.total, 0);
  const ccCount = matrix.length;
  const lastMonth = months[months.length - 1];
  const prevMonth = months[months.length - 2];
  const totalLast = matrix.reduce((s, r) => s + r.byMonth[months.length - 1], 0);
  const totalPrev = matrix.reduce((s, r) => s + (r.byMonth[months.length - 2] ?? 0), 0);
  const momPct = totalPrev > 0 ? ((totalLast - totalPrev) / totalPrev) * 100 : 0;

  // Top growth CC (compare avg first half × second half)
  const growth = matrix
    .map((r) => {
      const half = Math.floor(months.length / 2);
      const first = r.byMonth.slice(0, half).reduce((s, v) => s + v, 0) / Math.max(half, 1);
      const second =
        r.byMonth.slice(half).reduce((s, v) => s + v, 0) / Math.max(months.length - half, 1);
      const pct = first > 0 ? ((second - first) / first) * 100 : 0;
      return { cc: r.cc, pct, second };
    })
    .filter((g) => g.second > 0)
    .sort((a, b) => b.pct - a.pct);
  const topGrowth = growth[0];

  // Chart data: top 5 CCs
  const top5 = matrix.slice(0, 5);
  const chartData = months.map((mk, i) => {
    const row: Record<string, any> = { month: monthLabel(mk) };
    top5.forEach((r) => {
      row[ccDisplay(r.cc).label] = r.byMonth[i];
    });
    return row;
  });

  // Drill: load companies for a (cc, month) pair
  const loadDrill = async (cc: string) => {
    if (drillCompanies[cc]) {
      setExpandedCc(expandedCc === cc ? null : cc);
      return;
    }
    setExpandedCc(cc);
    setDrillLoading(true);
    const fromDate = `${firstMonth}-01`;
    const paymentIds = payments
      .filter((p) => (p.cost_center_code ?? "—") === cc)
      .map((p) => p.id);
    if (paymentIds.length === 0) {
      setDrillCompanies((s) => ({ ...s, [cc]: [] }));
      setDrillLoading(false);
      return;
    }
    const { data } = await supabase
      .from("payment_company_groups")
      .select("id,payment_id,company_id,company_name,liquido_total,bruto_total,total_amount,status")
      .in("payment_id", paymentIds)
      .neq("status", "cancelado");
    setDrillCompanies((s) => ({ ...s, [cc]: (data ?? []) as CompanyGroupRow[] }));
    setDrillLoading(false);
  };

  // Aggregate companies per CC (across months in window)
  const companiesByCc = (cc: string) => {
    const groups = drillCompanies[cc] ?? [];
    const agg = new Map<string, { name: string; total: number; lotes: Set<string> }>();
    groups.forEach((g) => {
      const key = g.company_id ?? g.company_name;
      const v = g.liquido_total ?? g.bruto_total ?? g.total_amount ?? 0;
      if (!agg.has(key)) agg.set(key, { name: g.company_name, total: 0, lotes: new Set() });
      const e = agg.get(key)!;
      e.total += v;
      e.lotes.add(g.payment_id);
    });
    return Array.from(agg.values()).sort((a, b) => b.total - a.total);
  };

  const exportCsv = () => {
    const head = ["Centro de custo", ...months.map(monthLabel), "Total"];
    const rows = matrix.map((r) => {
      const { label } = ccDisplay(r.cc);
      return [label, ...r.byMonth.map((v) => v.toFixed(2)), r.total.toFixed(2)];
    });
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evolucao-pagamentos-${mode}-${window}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="Evolução de Pagamentos por Centro de Custos"
        description="Série temporal e comparação mês a mês. Drill-down por centro de custo, empresa e lote."
        icon={TrendingUp}
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={loading || matrix.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Exportar CSV
          </Button>
        }
      />

      <div className="p-6 space-y-6">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList>
              <TabsTrigger value="competencia">Por competência</TabsTrigger>
              <TabsTrigger value="caixa">Por caixa (pago)</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={window} onValueChange={(v) => setWindow(v as Window)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6m">Últimos 6 meses</SelectItem>
              <SelectItem value="12m">Últimos 12 meses</SelectItem>
              <SelectItem value="ytd">YTD (ano atual)</SelectItem>
            </SelectContent>
          </Select>
          {mode === "caixa" && (
            <span className="text-xs text-muted-foreground">
              Caixa = pagamentos com status <code>pago</code> (data de atualização).
            </span>
          )}
        </div>

        {/* KPIs */}
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Total no período"
            tone="primary"
            value={loading ? <Skeleton className="h-8 w-32 bg-primary-foreground/20" /> : BRL(grandTotal)}
            hint={`${months.length} meses · ${ccCount} centros de custo`}
          />
          <KpiCard
            label={`Último mês (${monthLabel(lastMonth)})`}
            value={loading ? <Skeleton className="h-8 w-28" /> : BRL(totalLast)}
            hint={prevMonth ? `vs ${monthLabel(prevMonth)}: ${BRL(totalPrev)}` : "—"}
          />
          <KpiCard
            label="Variação MoM"
            tone={momPct >= 0 ? "success" : "danger"}
            value={loading ? <Skeleton className="h-8 w-20" /> : PCT(momPct)}
            hint={prevMonth ? `${monthLabel(prevMonth)} → ${monthLabel(lastMonth)}` : "—"}
          />
          <KpiCard
            label="Maior crescimento"
            value={
              loading ? (
                <Skeleton className="h-8 w-32" />
              ) : topGrowth ? (
                PCT(topGrowth.pct)
              ) : (
                "—"
              )
            }
            hint={topGrowth ? ccDisplay(topGrowth.cc).label : "Sem dados suficientes"}
          />
        </div>

        {/* Chart */}
        <div className="rounded-2xl border bg-card p-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Série temporal — Top 5 centros de custo
            </h2>
          </div>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length === 0 ? (
            <div className="h-72 grid place-items-center text-sm text-muted-foreground">
              Sem dados no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                />
                <Tooltip
                  formatter={(v: any) => BRL2(Number(v))}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {top5.map((r, i) => (
                  <Line
                    key={r.cc}
                    type="monotone"
                    dataKey={ccDisplay(r.cc).label}
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Matriz */}
        <div className="rounded-2xl border bg-card">
          <div className="p-6 pb-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Matriz CC × meses
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Clique em um centro de custo para ver a quebra por empresa. Clique no valor mensal para abrir os lotes daquele mês.
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[260px]">Centro de custo</TableHead>
                  {months.map((m) => (
                    <TableHead key={m} className="text-right whitespace-nowrap">
                      {monthLabel(m)}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Δ MoM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={months.length + 3}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : matrix.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={months.length + 3} className="text-center text-sm text-muted-foreground py-8">
                      Sem dados no período selecionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  matrix.map((r) => {
                    const last = r.byMonth[months.length - 1];
                    const prev = r.byMonth[months.length - 2] ?? 0;
                    const delta = prev > 0 ? ((last - prev) / prev) * 100 : last > 0 ? 100 : 0;
                    const open = expandedCc === r.cc;
                    const d = ccDisplay(r.cc);
                    return (
                      <FragmentRow key={r.cc}>
                        <TableRow className="cursor-pointer" onClick={() => loadDrill(r.cc)}>
                          <TableCell>
                            <div className="flex items-start gap-2">
                              {open ? <ChevronDown className="h-4 w-4 mt-0.5 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 text-muted-foreground" />}
                              <div>
                                <div className="font-medium">{d.label}</div>
                                <div className="text-xs text-muted-foreground">{d.sub}</div>
                              </div>
                            </div>
                          </TableCell>
                          {r.byMonth.map((v, i) => (
                            <TableCell
                              key={i}
                              className={cn(
                                "text-right tabular-nums whitespace-nowrap",
                                v === 0 && "text-muted-foreground/50",
                              )}
                              onClick={(e) => {
                                if (v > 0) {
                                  e.stopPropagation();
                                  setDialogCc({ code: r.cc, month: months[i] });
                                }
                              }}
                            >
                              {v > 0 ? BRL(v) : "—"}
                            </TableCell>
                          ))}
                          <TableCell className="text-right font-semibold tabular-nums">{BRL(r.total)}</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="outline" className={cn("tabular-nums", delta >= 0 ? "text-success" : "text-destructive")}>
                              {PCT(delta)}
                            </Badge>
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={months.length + 3} className="p-0">
                              <div className="px-6 py-4">
                                {drillLoading && !drillCompanies[r.cc] ? (
                                  <Skeleton className="h-20 w-full" />
                                ) : (
                                  <CompanyDrill
                                    companies={companiesByCc(r.cc)}
                                    totalCc={r.total}
                                  />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </FragmentRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Dialog: lotes de um (CC, mês) */}
      <Dialog open={!!dialogCc} onOpenChange={(o) => !o && setDialogCc(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialogCc ? `${ccDisplay(dialogCc.code).label} · ${monthLabel(dialogCc.month)}` : ""}
            </DialogTitle>
          </DialogHeader>
          {dialogCc && (
            <LotesList
              payments={payments.filter((p) => {
                if ((p.cost_center_code ?? "—") !== dialogCc.code) return false;
                const ds = mode === "competencia"
                  ? p.competence_month
                  : p.approved_at?.slice(0, 10) ?? p.updated_at.slice(0, 10);
                return ds?.slice(0, 7) === dialogCc.month;
              })}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CompanyDrill({
  companies,
  totalCc,
}: {
  companies: { name: string; total: number; lotes: Set<string> }[];
  totalCc: number;
}) {
  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem empresas neste centro de custo no período.</p>;
  }
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Quebra por empresa
      </div>
      <div className="space-y-1">
        {companies.map((c) => {
          const pct = totalCc > 0 ? (c.total / totalCc) * 100 : 0;
          return (
            <div key={c.name} className="flex items-center gap-3 text-sm py-1">
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.name}</div>
                <div className="h-1.5 mt-1 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="text-right tabular-nums">
                <div className="font-semibold">{BRL(c.total)}</div>
                <div className="text-xs text-muted-foreground">
                  {pct.toFixed(1)}% · {c.lotes.size} lote{c.lotes.size > 1 ? "s" : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LotesList({ payments }: { payments: PaymentRow[] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum lote.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Lote</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Valor</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((p) => {
          const v = p.liquido_total ?? p.bruto_total ?? p.total_amount ?? 0;
          return (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.reference ?? p.id.slice(0, 8)}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">{p.status}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">{BRL2(v)}</TableCell>
              <TableCell className="text-right">
                <Button asChild variant="ghost" size="sm">
                  <Link to={`/pagamentos/${p.id}`}>
                    Abrir <ExternalLink className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

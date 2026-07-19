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
import { TrendingUp, ChevronRight, ChevronDown, ExternalLink, Download, Filter, X, CalendarIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { MultiSelectChips } from "@/components/MultiSelectChips";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  LabelList,
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
type Window = "6m" | "12m" | "ytd" | "custom";

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
  payment_type: string | null;
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

function buildMonthRange(window: Window, customStart?: Date, customEnd?: Date): string[] {
  const now = new Date();
  const months: string[] = [];
  if (window === "custom" && customStart && customEnd) {
    const start = new Date(customStart.getFullYear(), customStart.getMonth(), 1);
    const end = new Date(customEnd.getFullYear(), customEnd.getMonth(), 1);
    const cur = new Date(start);
    while (cur <= end) {
      months.push(monthKey(cur));
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }
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
  const [customStart, setCustomStart] = useState<Date | undefined>();
  const [customEnd, setCustomEnd] = useState<Date | undefined>();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [ccMeta, setCcMeta] = useState<Record<string, CcMeta>>({});
  const [expandedCc, setExpandedCc] = useState<string | null>(null);
  const [drillCompanies, setDrillCompanies] = useState<Record<string, CompanyGroupRow[]>>({});
  const [drillLoading, setDrillLoading] = useState(false);
  const [dialogCc, setDialogCc] = useState<{ code: string; month: string } | null>(null);
  const [focusedLine, setFocusedLine] = useState<string | null>(null);
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
  const [focusedCompany, setFocusedCompany] = useState<{ cc: string; name: string } | null>(null);
  // Mês ancorador para "Último mês" / Variação MoM. "auto" = último fechado (não-corrente).
  const [anchorMonth, setAnchorMonth] = useState<string>("auto");

  // Filters
  const [ccFilter, setCcFilter] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [convenioFilter, setConvenioFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);

  // Option pools (extracted from loaded data)
  const [paymentCompanies, setPaymentCompanies] = useState<Map<string, Set<string>>>(new Map()); // payment_id → company names
  const [paymentConvenios, setPaymentConvenios] = useState<Map<string, Set<string>>>(new Map()); // payment_id → convenio slugs

  const months = useMemo(
    () => buildMonthRange(window, customStart, customEnd),
    [window, customStart, customEnd],
  );
  const firstMonth = months[0];

  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!hospital?.id) return;
      if (window === "custom" && (!customStart || !customEnd)) return;
      setLoading(true);
      const fromDate = `${firstMonth}-01`;
      const lastMk = months[months.length - 1];
      // Pull payments with either competence_month or approved/updated within window.
      let query = supabase
        .from("payments")
        .select(
          "id,reference,status,cost_center_code,competence_month,approved_at,updated_at,liquido_total,bruto_total,total_amount,payment_type",
        )
        .eq("hospital_id", hospital.id)
        .neq("status", "cancelado")
        .limit(5000);

      if (mode === "competencia") {
        query = query.gte("competence_month", fromDate);
        if (window === "custom") {
          const [ly, lm] = lastMk.split("-").map(Number);
          const lastDay = new Date(ly, lm, 0).getDate();
          query = query.lte("competence_month", `${lastMk}-${String(lastDay).padStart(2, "0")}`);
        }
      } else {
        // caixa: prefer approved_at, fallback updated_at; filter only "pago"
        query = query.eq("status", "pago").gte("updated_at", `${fromDate}T00:00:00`);
        if (window === "custom") {
          const [ly, lm] = lastMk.split("-").map(Number);
          const lastDay = new Date(ly, lm, 0).getDate();
          query = query.lte("updated_at", `${lastMk}-${String(lastDay).padStart(2, "0")}T23:59:59`);
        }
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

      // Load company & convenio mappings per payment_id (for filters)
      const pids = (data ?? []).map((p: any) => p.id);
      if (pids.length > 0) {
        const [grpsRes, itemsRes] = await Promise.all([
          supabase
            .from("payment_company_groups")
            .select("payment_id,company_name")
            .in("payment_id", pids)
            .neq("status", "cancelado"),
          supabase
            .from("payment_items")
            .select("payment_id,convenio_slug")
            .in("payment_id", pids)
            .not("convenio_slug", "is", null)
            .limit(50000),
        ]);
        if (!cancel) {
          const cmap = new Map<string, Set<string>>();
          (grpsRes.data ?? []).forEach((g: any) => {
            if (!cmap.has(g.payment_id)) cmap.set(g.payment_id, new Set());
            cmap.get(g.payment_id)!.add(g.company_name);
          });
          setPaymentCompanies(cmap);
          const vmap = new Map<string, Set<string>>();
          (itemsRes.data ?? []).forEach((it: any) => {
            if (!vmap.has(it.payment_id)) vmap.set(it.payment_id, new Set());
            vmap.get(it.payment_id)!.add(it.convenio_slug);
          });
          setPaymentConvenios(vmap);
        }
      } else {
        setPaymentCompanies(new Map());
        setPaymentConvenios(new Map());
      }
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [hospital?.id, mode, firstMonth, window, customStart?.getTime(), customEnd?.getTime()]);

  const ccDisplay = (code: string | null) => {
    if (!code) return { label: "Sem CC", sub: "—" };
    const m = ccMeta[code];
    if (!m) return { label: code, sub: "—" };
    const sub = [m.level1, m.level2, m.level3].filter(Boolean).join(" › ");
    return { label: m.level5 || m.level4 || m.level3 || code, sub: sub || code };
  };

  // Filter option pools (extracted from loaded data)
  const ccOptions = useMemo(() => {
    const set = new Set<string>();
    payments.forEach((p) => set.add(p.cost_center_code ?? "—"));
    return Array.from(set)
      .map((c) => ({ code: c, label: ccDisplay(c).label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [payments, ccMeta]);
  const ccLabelToCode = useMemo(() => {
    const m = new Map<string, string>();
    ccOptions.forEach((o) => m.set(o.label, o.code));
    return m;
  }, [ccOptions]);
  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    paymentCompanies.forEach((s) => s.forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [paymentCompanies]);
  const convenioOptions = useMemo(() => {
    const set = new Set<string>();
    paymentConvenios.forEach((s) => s.forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [paymentConvenios]);
  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    payments.forEach((p) => p.payment_type && set.add(p.payment_type));
    return Array.from(set).sort();
  }, [payments]);

  // Apply filters
  const filteredPayments = useMemo(() => {
    const ccCodes = ccFilter.map((l) => ccLabelToCode.get(l) ?? l);
    return payments.filter((p) => {
      if (ccCodes.length && !ccCodes.includes(p.cost_center_code ?? "—")) return false;
      if (typeFilter.length && !typeFilter.includes(p.payment_type ?? "")) return false;
      if (companyFilter.length) {
        const cs = paymentCompanies.get(p.id);
        if (!cs || !companyFilter.some((c) => cs.has(c))) return false;
      }
      if (convenioFilter.length) {
        const vs = paymentConvenios.get(p.id);
        if (!vs || !convenioFilter.some((v) => vs.has(v))) return false;
      }
      return true;
    });
  }, [payments, ccFilter, typeFilter, companyFilter, convenioFilter, paymentCompanies, paymentConvenios, ccLabelToCode]);

  const activeFilterCount =
    ccFilter.length + companyFilter.length + convenioFilter.length + typeFilter.length;
  const clearFilters = () => {
    setCcFilter([]);
    setCompanyFilter([]);
    setConvenioFilter([]);
    setTypeFilter([]);
  };

  // Mês vigente (em andamento). Só exibimos ele nas séries/KPIs/matriz
  // se houver pagamento efetivamente lançado nesse mês para o modo atual.
  // Caso contrário, o mês corrente é omitido para não "sujar" o gráfico
  // com um ponto zerado que empurra a tendência para baixo.
  const displayMonths = useMemo(() => {
    const cur = new Date().toISOString().slice(0, 7);
    if (!months.includes(cur)) return months;
    const hasData = filteredPayments.some((p) => {
      const ds =
        mode === "competencia"
          ? p.competence_month
          : p.approved_at?.slice(0, 10) ?? p.updated_at.slice(0, 10);
      return ds?.slice(0, 7) === cur;
    });
    return hasData ? months : months.filter((m) => m !== cur);
  }, [months, filteredPayments, mode]);

  // Bucket payments → cost center × month
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, number>>(); // cc → month → value
    const ccTotals = new Map<string, number>();
    filteredPayments.forEach((p) => {
      const cc = p.cost_center_code ?? "—";
      let dateStr: string | null;
      if (mode === "competencia") dateStr = p.competence_month;
      else dateStr = p.approved_at?.slice(0, 10) ?? p.updated_at.slice(0, 10);
      if (!dateStr) return;
      const mk = dateStr.slice(0, 7);
      if (!displayMonths.includes(mk)) return;
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
        byMonth: displayMonths.map((m) => row.get(m) ?? 0),
      }))
      .sort((a, b) => b.total - a.total);
    return rows;
  }, [filteredPayments, displayMonths, mode]);

  // KPIs
  const grandTotal = matrix.reduce((s, r) => s + r.total, 0);
  const ccCount = matrix.length;
  // O mês calendário corrente é "em andamento" — pagamentos ainda estão sendo gerados.
  // Por padrão (auto), ancoramos no último mês FECHADO. O usuário pode escolher
  // manualmente outro mês via o seletor "Mês ancorador" para comparar MoM em
  // cenários com competências em aberto.
  const currentYM = new Date().toISOString().slice(0, 7);
  const autoLastClosedIdx = (() => {
    for (let i = months.length - 1; i >= 0; i--) {
      if (months[i] !== currentYM) return i;
    }
    return months.length - 1;
  })();
  const manualIdx = anchorMonth !== "auto" ? months.indexOf(anchorMonth) : -1;
  const lastClosedIdx = manualIdx >= 0 ? manualIdx : autoLastClosedIdx;
  const prevClosedIdx = lastClosedIdx - 1;
  const lastMonth = months[lastClosedIdx];
  const prevMonth = prevClosedIdx >= 0 ? months[prevClosedIdx] : undefined;
  const isCurrentMonthInRange = months.includes(currentYM);
  const isManualAnchor = anchorMonth !== "auto" && manualIdx >= 0;
  const totalLast = matrix.reduce((s, r) => s + (r.byMonth[lastClosedIdx] ?? 0), 0);
  const totalPrev = matrix.reduce((s, r) => s + (r.byMonth[prevClosedIdx] ?? 0), 0);
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

  // Payment id → competence/cash month (depends on mode)
  const paymentMonth = useMemo(() => {
    const m = new Map<string, string>();
    payments.forEach((p) => {
      const ds =
        mode === "competencia"
          ? p.competence_month
          : p.approved_at?.slice(0, 10) ?? p.updated_at.slice(0, 10);
      if (ds) m.set(p.id, ds.slice(0, 7));
    });
    return m;
  }, [payments, mode]);

  // Company-focus chart series (single line: empresa dentro do CC, mês a mês)
  // ESTRITO: só lotes cujo cost_center_code === focusedCompany.cc.
  const companyChartData = useMemo(() => {
    if (!focusedCompany) return null;
    const groups = drillCompanies[focusedCompany.cc] ?? [];
    const ccPaymentIds = new Set(
      payments.filter((p) => (p.cost_center_code ?? "—") === focusedCompany.cc).map((p) => p.id),
    );
    const byMonth = new Map<string, number>();
    groups.forEach((g) => {
      if (g.company_name !== focusedCompany.name) return;
      if (!ccPaymentIds.has(g.payment_id)) return;
      const mk = paymentMonth.get(g.payment_id);
      if (!mk || !months.includes(mk)) return;
      const v = g.liquido_total ?? g.bruto_total ?? g.total_amount ?? 0;
      byMonth.set(mk, (byMonth.get(mk) ?? 0) + v);
    });
    return months.map((mk) => ({ month: monthLabel(mk), value: byMonth.get(mk) ?? 0 }));
  }, [focusedCompany, drillCompanies, paymentMonth, months, payments]);



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
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="6m">Últimos 6 meses</SelectItem>
              <SelectItem value="12m">Últimos 12 meses</SelectItem>
              <SelectItem value="ytd">YTD (ano atual)</SelectItem>
              <SelectItem value="custom">Período personalizado</SelectItem>
            </SelectContent>
          </Select>
          {window === "custom" && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("font-normal", !customStart && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customStart ? format(customStart, "MMM/yy", { locale: ptBR }) : "Início"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customStart} onSelect={setCustomStart} initialFocus className="pointer-events-auto p-3" />
                </PopoverContent>
              </Popover>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className={cn("font-normal", !customEnd && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {customEnd ? format(customEnd, "MMM/yy", { locale: ptBR }) : "Fim"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} initialFocus className="pointer-events-auto p-3" />
                </PopoverContent>
              </Popover>
            </>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="font-normal">
                <Filter className="mr-2 h-4 w-4" />
                Filtros
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2 h-5 px-1.5">{activeFilterCount}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] p-4 space-y-4" align="start">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Centro de custo</label>
                <MultiSelectChips
                  values={ccFilter}
                  onChange={setCcFilter}
                  options={ccOptions.map((o) => o.label)}
                  allowCustom={false}
                  placeholder="Todos"
                  emptyHint="Vazio = todos os CCs."
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Empresa (PJ)</label>
                <MultiSelectChips
                  values={companyFilter}
                  onChange={setCompanyFilter}
                  options={companyOptions}
                  allowCustom={false}
                  placeholder="Todas"
                  emptyHint="Vazio = todas as empresas."
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Convênio</label>
                <MultiSelectChips
                  values={convenioFilter}
                  onChange={setConvenioFilter}
                  options={convenioOptions}
                  allowCustom={false}
                  placeholder="Todos"
                  emptyHint="Vazio = todos os convênios."
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tipo de pagamento</label>
                <MultiSelectChips
                  values={typeFilter}
                  onChange={setTypeFilter}
                  options={typeOptions}
                  allowCustom={false}
                  placeholder="Todos"
                  emptyHint="Vazio = todos os tipos."
                />
              </div>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="w-full">
                  <X className="h-3 w-3 mr-1" /> Limpar filtros
                </Button>
              )}
            </PopoverContent>
          </Popover>
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-muted-foreground">
              Limpar filtros
            </Button>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Mês ancorador (MoM):</label>
            <Select value={anchorMonth} onValueChange={setAnchorMonth}>
              <SelectTrigger className="w-[200px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (último fechado)</SelectItem>
                {[...months].reverse().map((m) => (
                  <SelectItem key={m} value={m}>
                    {monthLabel(m)}{m === currentYM ? " (em andamento)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
            label={`${isManualAnchor ? "Mês ancorador" : "Último mês fechado"} (${monthLabel(lastMonth)})`}
            value={loading ? <Skeleton className="h-8 w-28" /> : BRL(totalLast)}
            hint={
              isManualAnchor
                ? prevMonth ? `vs ${monthLabel(prevMonth)}: ${BRL(totalPrev)} · manual` : "manual"
                : isCurrentMonthInRange
                  ? `${monthLabel(currentYM)} em andamento — excluído da comparação`
                  : prevMonth ? `vs ${monthLabel(prevMonth)}: ${BRL(totalPrev)}` : "—"
            }
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

        <div id="evolucao-chart" className="rounded-2xl border bg-card p-6 scroll-mt-4">
          <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Série temporal — Top 5 centros de custo
              </h2>
              <p className="text-[11px] text-muted-foreground mt-1">
                Clique no chip para focar uma linha. Use o × ao lado para ocultar e reescalar o eixo.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hiddenLines.size > 0 && (
                <button
                  type="button"
                  onClick={() => setHiddenLines(new Set())}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Mostrar todos ({hiddenLines.size} ocultos)
                </button>
              )}
              {focusedLine && (
                <button
                  type="button"
                  onClick={() => setFocusedLine(null)}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Limpar foco
                </button>
              )}
            </div>
          </div>


          {/* Chips de série: clique = foco, × = ocultar */}
          {top5.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {top5.map((r, i) => {
                const label = ccDisplay(r.cc).label;
                const color = PALETTE[i % PALETTE.length];
                const isHidden = hiddenLines.has(label);
                const isFocused = focusedLine === label;
                return (
                  <div
                    key={r.cc}
                    className={cn(
                      "group inline-flex items-center gap-1.5 rounded-full border pl-2.5 pr-1 py-1 text-xs transition-all",
                      isHidden
                        ? "opacity-40 border-dashed bg-muted/30"
                        : isFocused
                          ? "border-2 shadow-sm"
                          : "border bg-background hover:bg-muted/50",
                    )}
                    style={
                      isFocused && !isHidden
                        ? { borderColor: color, background: `${color}14` }
                        : undefined
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setFocusedLine((prev) => (prev === label ? null : label))
                      }
                      disabled={isHidden}
                      className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed"
                    >
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: color }}
                      />
                      <span
                        className={cn(
                          "font-medium",
                          isHidden && "line-through",
                        )}
                        style={{ color: isHidden ? undefined : color }}
                      >
                        {label}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setHiddenLines((prev) => {
                          const next = new Set(prev);
                          if (next.has(label)) next.delete(label);
                          else {
                            next.add(label);
                            if (focusedLine === label) setFocusedLine(null);
                          }
                          return next;
                        })
                      }
                      title={isHidden ? "Mostrar no gráfico" : "Ocultar do gráfico"}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length === 0 ? (
            <div className="h-72 grid place-items-center text-sm text-muted-foreground">
              Sem dados no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
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
                {top5.map((r, i) => {
                  const label = ccDisplay(r.cc).label;
                  if (hiddenLines.has(label)) return null;
                  const isFocused = focusedLine === label;
                  const isDimmed = focusedLine !== null && !isFocused;
                  const color = PALETTE[i % PALETTE.length];
                  const toggle = () =>
                    setFocusedLine((prev) => (prev === label ? null : label));
                  return (
                    <Fragment key={r.cc}>
                      {/* Hit-area invisível para facilitar o clique na linha */}
                      <Line
                        type="monotone"
                        dataKey={label}
                        stroke={color}
                        strokeWidth={16}
                        strokeOpacity={0}
                        dot={false}
                        activeDot={false}
                        legendType="none"
                        tooltipType="none"
                        style={{ cursor: "pointer" }}
                        onClick={toggle}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey={label}
                        stroke={color}
                        strokeWidth={isFocused ? 3.5 : isDimmed ? 1.5 : 2}
                        strokeOpacity={isDimmed ? 0.18 : 1}
                        dot={{ r: isFocused ? 4 : 3, opacity: isDimmed ? 0.25 : 1 }}
                        activeDot={{ r: 6, style: { cursor: "pointer" }, onClick: toggle }}
                        style={{ cursor: "pointer", pointerEvents: "none" }}
                        isAnimationActive={false}
                      >
                        <LabelList
                          dataKey={label}
                          position="top"
                          offset={8}
                          style={{
                            fontSize: 10,
                            fill: color,
                            fontWeight: 600,
                            opacity: isDimmed ? 0.25 : 1,
                          }}
                          formatter={(v: any) => {
                            const n = Number(v);
                            if (!n) return "";
                            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                            if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
                            return String(n);
                          }}
                        />
                      </Line>
                    </Fragment>
                  );
                })}
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
                    const last = r.byMonth[lastClosedIdx] ?? 0;
                    const prev = prevClosedIdx >= 0 ? (r.byMonth[prevClosedIdx] ?? 0) : 0;
                    const delta = prev > 0 ? ((last - prev) / prev) * 100 : last > 0 ? 100 : 0;
                    const open = expandedCc === r.cc;
                    const d = ccDisplay(r.cc);
                    return (
                      <Fragment key={r.cc}>
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
                                    focusedName={focusedCompany?.cc === r.cc ? focusedCompany.name : null}
                                    onSelectCompany={(name) => {
                                      setFocusedCompany({ cc: r.cc, name });
                                    }}
                                  />

                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </TableBody>
              {!loading && matrix.length > 0 && (() => {
                const monthTotals = months.map((_, i) => matrix.reduce((s, r) => s + (r.byMonth[i] ?? 0), 0));
                const grand = monthTotals.reduce((s, v) => s + v, 0);
                const lastT = monthTotals[lastClosedIdx] ?? 0;
                const prevT = prevClosedIdx >= 0 ? (monthTotals[prevClosedIdx] ?? 0) : 0;
                const deltaT = prevT > 0 ? ((lastT - prevT) / prevT) * 100 : lastT > 0 ? 100 : 0;
                return (
                  <tfoot className="border-t bg-muted/40 font-semibold">
                    <TableRow>
                      <TableCell className="font-semibold">Total por mês</TableCell>
                      {monthTotals.map((v, i) => (
                        <TableCell key={i} className={cn("text-right tabular-nums whitespace-nowrap", v === 0 && "text-muted-foreground/50")}>
                          {v > 0 ? BRL(v) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right tabular-nums">{BRL(grand)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={cn("tabular-nums", deltaT >= 0 ? "text-success" : "text-destructive")}>
                          {PCT(deltaT)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  </tfoot>
                );
              })()}
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
              payments={filteredPayments.filter((p) => {
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

      {/* Modo foco: evolução da empresa dentro do CC */}
      <Dialog open={!!focusedCompany} onOpenChange={(o) => !o && setFocusedCompany(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[0] }} />
              {focusedCompany?.name}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Evolução mensal em <span className="font-medium">{focusedCompany ? ccDisplay(focusedCompany.cc).label : ""}</span>
              {" · "}{mode === "competencia" ? "por competência" : "por caixa"}
            </p>
          </DialogHeader>
          {focusedCompany && companyChartData && (() => {
            const total = companyChartData.reduce((s, d) => s + d.value, 0);
            const last = companyChartData[lastClosedIdx]?.value ?? 0;
            const prev = prevClosedIdx >= 0 ? (companyChartData[prevClosedIdx]?.value ?? 0) : 0;
            const delta = prev > 0 ? ((last - prev) / prev) * 100 : last > 0 ? 100 : 0;
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-lg border p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total no período</div>
                    <div className="text-lg font-semibold tabular-nums">{BRL(total)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{monthLabel(lastMonth)}</div>
                    <div className="text-lg font-semibold tabular-nums">{BRL(last)}</div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Δ MoM</div>
                    <div className={cn("text-lg font-semibold tabular-nums", delta >= 0 ? "text-success" : "text-destructive")}>{PCT(delta)}</div>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={companyChartData} margin={{ top: 24, right: 16, left: 0, bottom: 8 }}>
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
                    <Line
                      type="monotone"
                      dataKey="value"
                      name={focusedCompany.name}
                      stroke={PALETTE[0]}
                      strokeWidth={3}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                      isAnimationActive={false}
                    >
                      <LabelList
                        dataKey="value"
                        position="top"
                        offset={8}
                        style={{ fontSize: 10, fill: PALETTE[0], fontWeight: 600 }}
                        formatter={(v: any) => {
                          const n = Number(v);
                          if (!n) return "";
                          if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                          if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
                          return String(n);
                        }}
                      />
                    </Line>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}


function CompanyDrill({
  companies,
  totalCc,
  onSelectCompany,
  focusedName,
}: {
  companies: { name: string; total: number; lotes: Set<string> }[];
  totalCc: number;
  onSelectCompany?: (name: string) => void;
  focusedName?: string | null;
}) {
  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem empresas neste centro de custo no período.</p>;
  }
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Quebra por empresa <span className="font-normal normal-case text-muted-foreground/80">· clique para abrir a evolução em modo foco</span>
      </div>
      <div className="space-y-1">
        {companies.map((c) => {
          const pct = totalCc > 0 ? (c.total / totalCc) * 100 : 0;
          const isFocused = focusedName === c.name;
          return (
            <button
              type="button"
              key={c.name}
              onClick={() => onSelectCompany?.(c.name)}
              className={cn(
                "w-full text-left flex items-center gap-3 text-sm py-1.5 px-2 rounded-md transition-colors",
                isFocused ? "bg-primary/10 ring-1 ring-primary/40" : "hover:bg-muted/60",
              )}
            >
              <div className="flex-1 min-w-0">
                <div className={cn("font-medium truncate", isFocused && "text-primary")}>{c.name}</div>
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
            </button>
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

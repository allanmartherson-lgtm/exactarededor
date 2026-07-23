import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Plus, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PAYMENT_TRACK_SHORT_LABELS, type PaymentTrack } from "@/lib/status";

/**
 * Pivot histórico exibido nas visões "Compacto" (validador) e "Executivo"
 * (diretor). Na visão "Detalhe" (analista) o componente retorna null para
 * preservar exatamente o layout atual da página.
 */
export type PivotVariant = "detalhe" | "compacto" | "executivo";

type GroupingField = "especialidade" | "empresa" | "medico" | "centro_custo";

interface Props {
  paymentId: string;
  paymentReference: string;
  /** Primeiro dia do mês de competência do pagamento (YYYY-MM-DD). */
  competenceDate: string;
  variant: PivotVariant;
}

type PivotRow = {
  group_key: string;
  parent_key: string | null;
  month_bucket: string; // YYYY-MM-DD
  total: number;
};

const PRESETS_BY_VARIANT: Record<Exclude<PivotVariant, "detalhe">, GroupingField[]> = {
  compacto: ["especialidade", "empresa", "medico"],
  executivo: ["especialidade", "empresa"],
};

const FIELD_LABELS: Record<GroupingField, string> = {
  especialidade: "Especialidade",
  empresa: "Empresa",
  medico: "Médico",
  centro_custo: "Centro de custo",
};

const PERIOD_OPTIONS = [
  { value: 3, label: "3 meses" },
  { value: 6, label: "6 meses" },
  { value: 12, label: "12 meses" },
];

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MONTH_FMT = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });

function monthLabel(iso: string) {
  // iso esperado: YYYY-MM-DD (primeiro dia do mês)
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return MONTH_FMT.format(d).replace(".", "");
}

function buildMonthList(currentMonth: string, monthsBack: number): string[] {
  const base = new Date(`${currentMonth.slice(0, 10)}T00:00:00`);
  const list: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    list.push(d.toISOString().slice(0, 10));
  }
  return list;
}

function variationClass(deltaPct: number) {
  const abs = Math.abs(deltaPct);
  if (abs >= 30 && deltaPct > 0) return "text-success font-medium";
  if (abs >= 30 && deltaPct < 0) return "text-destructive font-medium";
  return "text-muted-foreground";
}

function variationArrow(deltaPct: number) {
  const abs = Math.abs(deltaPct);
  if (abs >= 30 && deltaPct > 0) return "↗";
  if (abs >= 30 && deltaPct < 0) return "↘";
  return "≈";
}

function kpiCardBg(deltaPct: number) {
  const abs = Math.abs(deltaPct);
  if (abs >= 30 && deltaPct > 0) return "bg-success-soft";
  if (abs >= 30 && deltaPct < 0) return "bg-destructive-soft";
  if (abs >= 5) return "bg-warning-soft";
  return "bg-muted";
}

function SortableTh({
  children,
  align,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  align: "left" | "right";
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      data-pivot-th=""
      className={cn(
        "px-3 py-2 text-[11px] font-medium uppercase tracking-wide select-none cursor-pointer hover:bg-primary/10 transition-colors",
        align === "left" ? "text-left" : "text-right tabular-nums",
      )}
      onClick={onClick}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1",
          align === "right" ? "justify-end" : "",
        )}
      >
        {children}
        <Icon
          className={cn(
            "h-3 w-3 shrink-0",
            active ? "text-foreground" : "text-muted-foreground/40",
          )}
        />
      </span>
    </th>
  );
}


export function PaymentPivotSection({
  paymentId,
  paymentReference: _ref,
  competenceDate,
  variant,
}: Props) {
  // Hooks devem ser sempre chamados — então mantemos a estrutura mesmo
  // quando vamos retornar null no render para a variant "detalhe".
  const presets = useMemo(
    () => (variant === "detalhe" ? [] : PRESETS_BY_VARIANT[variant]),
    [variant],
  );

  const [grouping, setGrouping] = useState<GroupingField>("especialidade");
  const [monthsBack, setMonthsBack] = useState<number>(3);
  const [rows, setRows] = useState<PivotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [customOpen, setCustomOpen] = useState(false);
  const [customFields, setCustomFields] = useState<GroupingField[]>([]);
  const [alertsCount, setAlertsCount] = useState<number>(0);
  // Trilha do lote atual (carregada do DB). Vira o default do filtro.
  const [lotTrack, setLotTrack] = useState<PaymentTrack | null>(null);
  const [trackFilter, setTrackFilter] = useState<"auto" | PaymentTrack | "todos">("auto");
  // Secundário (drilldown): controlado pelo usuário via "Customizar".
  // Default no compacto = derivação histórica (empresa↔especialidade). No executivo = null.
  const [secondary, setSecondary] = useState<GroupingField | null>(null);
  // Empresas presentes no lote atual (nomes normalizados). Usado para restringir
  // o agrupamento por empresa apenas às PJs deste lote — muito útil em lotes
  // pequenos onde toda a base histórica polui a comparação.
  const [lotCompanyNames, setLotCompanyNames] = useState<string[] | null>(null);
  const [restrictToLotCompanies, setRestrictToLotCompanies] = useState<boolean>(true);
  // Guard para só aplicar o default automático (grouping = empresa) uma vez.
  const [autoDefaultApplied, setAutoDefaultApplied] = useState(false);
  // Ordenação da tabela. key = "label" | "delta" | "<month-iso>".
  // Default: maior valor do mês atual (mesmo comportamento anterior).
  const [sortKey, setSortKey] = useState<string>("__current__");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "label" ? "asc" : "desc");
    }
  };

  useEffect(() => {
    if (variant === "detalhe") return;
    if (!competenceDate || !/^\d{4}-\d{2}-\d{2}/.test(competenceDate)) {
      console.warn("[PaymentPivot] competenceDate inválido:", competenceDate);
      setRows([]);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    (async () => {
      const sec: GroupingField | null = secondary && secondary !== grouping ? secondary : null;
      // Resolve trilha efetiva:
      //  - "auto" → trilha do lote atual (filtra mesmos lotes); se lote não tem trilha, manda nada (= todos)
      //  - "todos" → explicitamente desliga o filtro
      //  - prioritario | habitual → força a trilha escolhida
      let effectiveTrack: string | null = null;
      if (trackFilter === "auto") {
        effectiveTrack = lotTrack ?? null;
      } else if (trackFilter === "todos") {
        effectiveTrack = "todos";
      } else {
        effectiveTrack = trackFilter;
      }
      const args: Record<string, unknown> = {
        p_current_month: competenceDate.slice(0, 10),
        p_months_back: monthsBack,
        p_grouping: grouping,
      };
      if (sec) args.p_secondary = sec;
      if (paymentId) args.p_payment_id = paymentId;
      if (effectiveTrack) args.p_track = effectiveTrack;
      const callId = Math.random().toString(36).slice(2, 8);
      console.log(`[PaymentPivot ${callId}] rpc args:`, args);
      const { data, error } = await supabase.rpc("get_payment_pivot", args as {
        p_current_month: string;
        p_months_back: number;
        p_grouping: string;
        p_secondary?: string;
        p_payment_id?: string;
        p_track?: string;
      });
      if (!alive) return;
      if (error) {
        console.error(`[PaymentPivot ${callId}] rpc error:`, error);
        console.error(`[PaymentPivot ${callId}] rpc error stringified:`, JSON.stringify(error, null, 2));
        console.error(`[PaymentPivot ${callId}] rpc error keys:`, Object.keys(error || {}));
        setRows([]);
      } else {
        console.log(`[PaymentPivot ${callId}] rpc rows count:`, data?.length ?? 0);
        setRows((data ?? []) as PivotRow[]);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [variant, grouping, secondary, monthsBack, competenceDate, paymentId, trackFilter, lotTrack]);

  // Carrega a trilha do lote atual (uma vez por paymentId).
  useEffect(() => {
    if (!paymentId) {
      setLotTrack(null);
      return;
    }
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("payments")
        .select("payment_track")
        .eq("id", paymentId)
        .maybeSingle();
      if (alive) setLotTrack((data?.payment_track ?? null) as PaymentTrack | null);
    })();
    return () => { alive = false; };
  }, [paymentId]);

  // Carrega as empresas presentes NESTE lote (por payment_company_financials,
  // que já reflete o rateio real por PJ). Serve para restringir o pivot ao
  // universo do lote quando o analista quiser comparar apenas essas PJs.
  useEffect(() => {
    if (variant === "detalhe" || !paymentId) {
      setLotCompanyNames(null);
      return;
    }
    let alive = true;
    (async () => {
      const { data: fin } = await supabase
        .from("payment_company_financials")
        .select("company_id")
        .eq("payment_id", paymentId);
      const ids = Array.from(new Set((fin ?? []).map((r) => r.company_id).filter(Boolean)));
      if (!ids.length) {
        // Fallback: usa payment_items (cobre lotes sem financials calculado).
        const { data: items } = await supabase
          .from("payment_items")
          .select("company_id")
          .eq("payment_id", paymentId)
          .not("company_id", "is", null);
        const itemIds = Array.from(new Set((items ?? []).map((r) => r.company_id).filter(Boolean)));
        if (!itemIds.length) {
          if (alive) setLotCompanyNames([]);
          return;
        }
        const { data: cs } = await supabase.from("companies").select("name").in("id", itemIds);
        if (alive) {
          setLotCompanyNames((cs ?? []).map((c) => (c.name ?? "").trim().toLowerCase()).filter(Boolean));
        }
        return;
      }
      const { data: cs } = await supabase.from("companies").select("name").in("id", ids);
      if (alive) {
        setLotCompanyNames((cs ?? []).map((c) => (c.name ?? "").trim().toLowerCase()).filter(Boolean));
      }
    })();
    return () => { alive = false; };
  }, [variant, paymentId]);

  // Comportamento padrão: lotes pequenos (< 5 PJs) já entram agrupados por
  // empresa e restritos às PJs do próprio lote. Só aplica uma vez para não
  // sobrescrever a escolha do usuário depois.
  useEffect(() => {
    if (variant === "detalhe") return;
    if (autoDefaultApplied || lotCompanyNames === null) return;
    if (lotCompanyNames.length > 0 && lotCompanyNames.length < 5) {
      setGrouping("empresa");
      setRestrictToLotCompanies(true);
    }
    setAutoDefaultApplied(true);
  }, [variant, autoDefaultApplied, lotCompanyNames]);


  // Conta alertas críticos do pagamento atual (somente compacto exibe).
  useEffect(() => {
    if (variant !== "compacto" || !paymentId) return;
    let alive = true;
    (async () => {
      const { count } = await supabase
        .from("payment_items")
        .select("id", { count: "exact", head: true })
        .eq("payment_id", paymentId)
        .in("ai_status", ["reprovado", "alerta"]);
      if (alive) setAlertsCount(count ?? 0);
    })();
    return () => {
      alive = false;
    };
  }, [variant, paymentId]);

  const months = useMemo(() => buildMonthList(competenceDate, monthsBack), [competenceDate, monthsBack]);
  const currentMonth = months[months.length - 1];
  const previousMonths = months.slice(0, -1);

  // Agrega rows em estrutura primária + secundária por mês.
  const { primaryRows, totalsByMonth, totalGeral } = useMemo(() => {
    const primary = new Map<string, Map<string, number>>();
    const childrenMap = new Map<string, Map<string, Map<string, number>>>(); // parent -> child -> month -> total
    let primaryCount = 0;
    let childCount = 0;
    rows.forEach((r) => {
      const monthIso = r.month_bucket.slice(0, 10);
      if (r.parent_key) {
        childCount++;
        if (!childrenMap.has(r.parent_key)) childrenMap.set(r.parent_key, new Map());
        const c = childrenMap.get(r.parent_key)!;
        if (!c.has(r.group_key)) c.set(r.group_key, new Map());
        c.get(r.group_key)!.set(monthIso, Number(r.total) || 0);
      } else {
        primaryCount++;
        if (!primary.has(r.group_key)) primary.set(r.group_key, new Map());
        primary.get(r.group_key)!.set(monthIso, Number(r.total) || 0);
      }
    });
    console.log("[PaymentPivot] parsed:", { primaryCount, childCount, primaryMapSize: primary.size, childrenMapSize: childrenMap.size });

    const totalsByMonth = new Map<string, number>();
    const primaryList = Array.from(primary.entries())
      .map(([key, byMonth]) => {
        months.forEach((m) => {
          totalsByMonth.set(m, (totalsByMonth.get(m) ?? 0) + (byMonth.get(m) ?? 0));
        });
        const current = byMonth.get(currentMonth) ?? 0;
        // Considera só meses anteriores com dado (> 0). Meses sem produção
        // (ex.: pré-go-live) não devem reduzir a média.
        const prevValues = previousMonths
          .map((m) => byMonth.get(m) ?? 0)
          .filter((v) => v > 0);
        const avg =
          prevValues.length > 0 ? prevValues.reduce((a, b) => a + b, 0) / prevValues.length : 0;
        const deltaPct = avg > 0 ? ((current - avg) / avg) * 100 : 0;
        const children = childrenMap.get(key);
        const childrenList = children
          ? Array.from(children.entries())
              .map(([ck, cByMonth]) => {
                const cCur = cByMonth.get(currentMonth) ?? 0;
                const cPrev = previousMonths
                  .map((m) => cByMonth.get(m) ?? 0)
                  .filter((v) => v > 0);
                const cAvg =
                  cPrev.length > 0 ? cPrev.reduce((a, b) => a + b, 0) / cPrev.length : 0;
                const cDelta = cAvg > 0 ? ((cCur - cAvg) / cAvg) * 100 : 0;
                return { key: ck, byMonth: cByMonth, deltaPct: cDelta, total: cCur };
              })
              .sort((a, b) => b.total - a.total)
          : [];
        return { key, byMonth, current, avg, deltaPct, children: childrenList };
      })
      .sort((a, b) => b.current - a.current);

    let totalGeral = 0;
    totalsByMonth.forEach((v) => (totalGeral += v));
    return { primaryRows: primaryList, totalsByMonth, totalGeral };
  }, [rows, months, currentMonth, previousMonths]);

  const totalCurrent = totalsByMonth.get(currentMonth) ?? 0;
  // Meses anteriores efetivamente com dado — base honesta para a média.
  const effectivePrevMonths = useMemo(
    () => previousMonths.filter((m) => (totalsByMonth.get(m) ?? 0) > 0),
    [previousMonths, totalsByMonth],
  );
  const totalPrevAvg = useMemo(() => {
    if (effectivePrevMonths.length === 0) return 0;
    const sum = effectivePrevMonths.reduce((acc, m) => acc + (totalsByMonth.get(m) ?? 0), 0);
    return sum / effectivePrevMonths.length;
  }, [effectivePrevMonths, totalsByMonth]);
  const totalDelta = totalPrevAvg > 0 ? ((totalCurrent - totalPrevAvg) / totalPrevAvg) * 100 : 0;

  // Aplica ordenação escolhida pelo usuário ao primaryRows. "__current__"
  // mantém o default (mês atual desc). Children não são reordenadas.
  const sortedRows = useMemo(() => {
    const arr = [...primaryRows];
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortKey === "label") {
      arr.sort((a, b) => a.key.localeCompare(b.key, "pt-BR") * dir);
    } else if (sortKey === "delta") {
      arr.sort((a, b) => (a.deltaPct - b.deltaPct) * dir);
    } else if (sortKey === "__current__") {
      arr.sort((a, b) => (a.current - b.current) * -1); // sempre desc
    } else {
      // chave = ISO de um mês específico
      arr.sort((a, b) => ((a.byMonth.get(sortKey) ?? 0) - (b.byMonth.get(sortKey) ?? 0)) * dir);
    }
    return arr;
  }, [primaryRows, sortKey, sortDir]);

  if (variant === "detalhe") return null;

  const showAlerts = variant === "compacto";
  const allowedFields: GroupingField[] = ["especialidade", "empresa", "medico", "centro_custo"];
  const groupLabel = variant === "compacto" ? "Agrupar:" : "Ver por:";

  const toggleExpanded = (k: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  };

  const applyCustom = () => {
    if (customFields.length > 0) {
      setGrouping(customFields[0]);
      setSecondary(customFields[1] ?? null);
      setExpanded(new Set());
    }
    setCustomOpen(false);
  };

  return (
    <Card className="shadow-card">
      <CardContent className="p-4 space-y-4">
        {/* KPIs */}
        <div className={cn("grid grid-cols-1 gap-3", showAlerts ? "md:grid-cols-4" : "md:grid-cols-3")}>
          <KpiTile label="Total deste mês" value={BRL.format(totalCurrent)} />
          <KpiTile label={`Média ${effectivePrevMonths.length || 0}m`} value={BRL.format(totalPrevAvg)} />
          <KpiTile
            label="Variação vs média"
            value={`${variationArrow(totalDelta)} ${totalDelta > 0 ? "+" : ""}${totalDelta.toFixed(1)}%`}
            valueClassName={variationClass(totalDelta)}
            bgClassName={kpiCardBg(totalDelta)}
          />
          {showAlerts && (
            <KpiTile
              label="Alertas críticos"
              value={String(alertsCount)}
              bgClassName={alertsCount > 0 ? "bg-destructive-soft" : "bg-muted"}
              valueClassName={alertsCount > 0 ? "text-destructive font-medium" : "text-muted-foreground"}
            />
          )}
        </div>

        {/* Linha de configuração */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="section-label text-[10px] uppercase tracking-wider text-muted-foreground">
            {groupLabel}
          </span>
          {presets.map((p) => (
            <Button
              key={p}
              size="sm"
              variant={grouping === p ? "default" : "outline"}
              onClick={() => setGrouping(p)}
              className="h-7 px-3 text-xs"
            >
              {FIELD_LABELS[p]}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCustomFields([grouping, ...(secondary ? [secondary] : [])]);
              setCustomOpen(true);
            }}
            className="h-7 px-3 text-xs border-dashed"
          >
            <Plus className="h-3 w-3 mr-1" /> Customizar
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Trilha</span>
            <Select value={trackFilter} onValueChange={(v) => setTrackFilter(v as typeof trackFilter)}>
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-xs">
                  {lotTrack
                    ? `Igual ao lote (${PAYMENT_TRACK_SHORT_LABELS[lotTrack]})`
                    : "Igual ao lote"}
                </SelectItem>
                <SelectItem value="habitual" className="text-xs">Só Habitual</SelectItem>
                <SelectItem value="prioritario" className="text-xs">Só Prioritário</SelectItem>
                <SelectItem value="todos" className="text-xs">Todos</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Período</span>
            <Select value={String(monthsBack)} onValueChange={(v) => setMonthsBack(Number(v))}>
              <SelectTrigger className="h-7 w-[110px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabela pivot */}
        <div className="rounded-md border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-primary/5">
              <tr>
                <SortableTh
                  align="left"
                  active={sortKey === "label"}
                  dir={sortDir}
                  onClick={() => toggleSort("label")}
                >
                  {FIELD_LABELS[grouping]}
                </SortableTh>
                {months.map((m) => (
                  <SortableTh
                    key={m}
                    align="right"
                    active={sortKey === m}
                    dir={sortDir}
                    onClick={() => toggleSort(m)}
                  >
                    {monthLabel(m)}
                  </SortableTh>
                ))}
                <SortableTh
                  align="right"
                  active={sortKey === "delta"}
                  dir={sortDir}
                  onClick={() => toggleSort("delta")}
                >
                  Δ vs média
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={months.length + 2} className="px-3 py-6 text-center text-muted-foreground text-xs">
                    Carregando histórico…
                  </td>
                </tr>
              )}
              {!loading && sortedRows.length === 0 && (
                <tr>
                  <td colSpan={months.length + 2} className="px-3 py-6 text-center text-muted-foreground text-xs">
                    Sem dados no período selecionado.
                  </td>
                </tr>
              )}
              {!loading &&
                sortedRows.map((r) => {
                  const isOpen = expanded.has(r.key);
                  const canDrill = r.children.length > 0;
                  return (
                    <>
                      <tr key={r.key} className="border-t border-border even:bg-muted/20 hover:bg-muted/30">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => canDrill && toggleExpanded(r.key)}
                            className={cn(
                              "inline-flex items-center gap-1.5 text-left",
                              canDrill ? "cursor-pointer" : "cursor-default",
                            )}
                          >
                            {canDrill ? (
                              isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                              )
                            ) : (
                              <span className="inline-block w-3.5" />
                            )}
                            <span className="font-medium text-foreground">{r.key}</span>
                          </button>
                        </td>
                        {months.map((m) => (
                          <td key={m} className="px-3 py-2 text-right tabular-nums text-foreground">
                            {BRL.format(r.byMonth.get(m) ?? 0)}
                          </td>
                        ))}
                        <td className={cn("px-3 py-2 text-right tabular-nums", variationClass(r.deltaPct))}>
                          {variationArrow(r.deltaPct)} {r.deltaPct > 0 ? "+" : ""}
                          {r.deltaPct.toFixed(1)}%
                        </td>
                      </tr>
                      {canDrill &&
                        isOpen &&
                        r.children.map((c) => (
                          <tr key={`${r.key}::${c.key}`} className="border-t border-border/60 bg-muted/10">
                            <td className="px-3 py-1.5 cell-secondary border-l-2 border-primary/20">
                              <span className="inline-block" style={{ paddingLeft: 20 }}>
                                <span className="text-[12px] text-muted-foreground">{c.key}</span>
                              </span>
                            </td>
                            {months.map((m) => (
                              <td key={m} className="px-3 py-1.5 text-right tabular-nums text-[12px] text-muted-foreground">
                                {BRL.format(c.byMonth.get(m) ?? 0)}
                              </td>
                            ))}
                            <td
                              className={cn(
                                "px-3 py-1.5 text-right tabular-nums text-[12px]",
                                variationClass(c.deltaPct),
                              )}
                            >
                              {variationArrow(c.deltaPct)} {c.deltaPct > 0 ? "+" : ""}
                              {c.deltaPct.toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                    </>
                  );
                })}
              {!loading && primaryRows.length > 0 && (
                <tr className="border-t-2 border-primary/20 bg-muted font-semibold">
                  <td className="px-3 py-2 font-semibold">Total Geral</td>
                  {months.map((m) => (
                    <td key={m} className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                      {BRL.format(totalsByMonth.get(m) ?? 0)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                    {variationArrow(totalDelta)} {totalDelta > 0 ? "+" : ""}
                    {totalDelta.toFixed(1)}%
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Total geral em texto livre (apenas debug visual) */}
        <p className="text-[11px] text-muted-foreground">
          Soma de {monthsBack} {monthsBack === 1 ? "mês" : "meses"}: {BRL.format(totalGeral)}
        </p>
      </CardContent>

      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Customizar agrupamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              Selecione e ordene os campos. O primeiro define o agrupamento principal; o segundo, o
              drilldown (expansível em cada linha).
            </p>
            {allowedFields.map((f) => {
              const selectedIndex = customFields.indexOf(f);
              return (
                <label
                  key={f}
                  className="flex items-center gap-2 rounded-md border border-border p-2 text-sm cursor-pointer hover:bg-muted/30"
                >
                  <Checkbox
                    checked={selectedIndex >= 0}
                    onCheckedChange={(checked) => {
                      setCustomFields((prev) => {
                        if (checked) return prev.includes(f) ? prev : [...prev, f];
                        return prev.filter((x) => x !== f);
                      });
                    }}
                  />
                  <span className="flex-1">{FIELD_LABELS[f]}</span>
                  {selectedIndex >= 0 && (
                    <span className="text-[11px] text-muted-foreground">#{selectedIndex + 1}</span>
                  )}
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={applyCustom} disabled={customFields.length === 0}>
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function KpiTile({
  label,
  value,
  valueClassName,
  bgClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
  bgClassName?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border p-3", bgClassName ?? "bg-card shadow-card")}>
      <p className="card-label text-[10px] uppercase tracking-[0.06em]">
        {label}
      </p>
      <p className={cn("stat-number text-2xl font-medium text-foreground mt-1", valueClassName)}>{value}</p>
    </div>
  );
}

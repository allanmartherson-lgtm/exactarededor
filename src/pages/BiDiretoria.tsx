import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Link } from "react-router-dom";
import { Calendar, AlertTriangle, TrendingUp, ChevronRight, AlertCircle, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";

/**
 * BI · Diretoria — visão consolidada (Apple-style)
 *
 * Página puramente visual: lê dados reais de payments e payment_items
 * mas se a query falhar usa fallback estático para não quebrar a tela.
 * Não substitui nem altera o ExecutiveDashboard nem o FinancialIntelligence.
 */

type Period = "semana" | "mes" | "trimestre" | "ano";

const PERIOD_MONTHS: Record<Period, number> = { semana: 1, mes: 1, trimestre: 3, ano: 12 };

const fmtMi = (v: number) => {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return formatCurrency(v);
};
const fmtCompact = (v: number) => {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return formatCurrency(v);
};
const fmtFull = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_PT_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// ---------- Donut SVG ----------
function Donut({ pct, size = 188, stroke = 18 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}% automático`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--destructive))" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${c - dash}`}
        strokeDashoffset={c / 4}
        strokeLinecap="butt"
        transform={`rotate(-90 ${size / 2} ${size / 2}) scale(1,-1) translate(0,-${size})`}
      />
      <text
        x="50%"
        y="48%"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size * 0.22}
        fontWeight={700}
        fill="hsl(var(--foreground))"
        style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}
      >
        {pct}%
      </text>
      <text
        x="50%"
        y="62%"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={size * 0.06}
        fontWeight={600}
        letterSpacing="0.1em"
        fill="hsl(var(--muted-foreground))"
      >
        AUTOMÁTICO
      </text>
    </svg>
  );
}

// ---------- Sparkline SVG ----------
function HeroSparkline({ data, height = 180 }: { data: number[]; height?: number }) {
  const width = 720; // viewBox; escala via CSS
  const pad = 24;
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = Math.max(1, max - min);
  const stepX = (width - pad * 2) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = points.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x},${y}` : ` L${x},${y}`), "");
  const last = points[points.length - 1];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
      aria-hidden
    >
      {/* baseline grid */}
      {[0.25, 0.5, 0.75].map((t) => (
        <line
          key={t}
          x1={pad}
          x2={width - pad}
          y1={pad + (height - pad * 2) * t}
          y2={pad + (height - pad * 2) * t}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={1}
        />
      ))}
      <path d={path} fill="none" stroke="white" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={5} fill="white" />
    </svg>
  );
}

// ---------- Evolution chart (area + dashed line) ----------
function EvolutionChart({
  data,
  riskData,
  months,
  height = 260,
}: {
  data: number[];
  riskData?: number[];
  months?: string[];
  height?: number;
}) {
  const width = 720;
  const pad = 36;
  if (data.length < 2) return null;
  // Se não veio série real de risco, usa fração determinística (fallback do mock)
  const risk = riskData && riskData.length === data.length
    ? riskData
    : data.map((v, i) => v * (0.08 + (i % 3) * 0.015));
  const max = Math.max(...data, ...risk);
  const min = 0;
  const range = Math.max(1, max - min);
  const stepX = (width - pad * 2) / (data.length - 1);
  const toPoints = (arr: number[]) =>
    arr.map((v, i) => {
      const x = pad + i * stepX;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return [x, y] as const;
    });
  const points = toPoints(data);
  const riskPoints = toPoints(risk);
  const linePath = (pts: readonly (readonly [number, number])[]) =>
    pts.reduce((acc, [x, y], i) => acc + (i === 0 ? `M${x},${y}` : ` L${x},${y}`), "");
  const areaPath =
    linePath(points) +
    ` L${points[points.length - 1][0]},${height - pad} L${points[0][0]},${height - pad} Z`;
  const last = points[points.length - 1];
  const ymarks = [0, 0.5, 1, 1.5, 2].map((v) => v * 1_000_000).filter((v) => v <= max * 1.05);

  const compact = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
    if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
    return String(Math.round(v));
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: "100%", height, display: "block" }} aria-hidden>
      <defs>
        <linearGradient id="bi-area-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ymarks.map((v) => {
        const y = height - pad - ((v - min) / range) * (height - pad * 2);
        return (
          <g key={v}>
            <line x1={pad} x2={width - pad} y1={y} y2={y} stroke="hsl(var(--border))" strokeWidth={1} />
            <text x={pad - 6} y={y + 3} textAnchor="end" fontSize={10} fill="hsl(var(--muted-foreground))">
              {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill="url(#bi-area-grad)" />
      <path d={linePath(points)} fill="none" stroke="hsl(var(--primary))" strokeWidth={2.5} strokeLinejoin="round" />
      <path d={linePath(riskPoints)} fill="none" stroke="hsl(var(--destructive))" strokeWidth={2} strokeDasharray="6 4" />
      {/* Rótulos série "Processado" (acima do ponto) */}
      {points.map(([x, y], i) => (
        <g key={`p-${i}`}>
          <circle cx={x} cy={y} r={i === points.length - 1 ? 5 : 3} fill="hsl(var(--primary))" />
          <text x={x} y={y - 8} textAnchor="middle" fontSize={10} fontWeight={600} fill="hsl(var(--foreground))" style={{ fontVariantNumeric: "tabular-nums" }}>
            {compact(data[i])}
          </text>
        </g>
      ))}
      {/* Rótulos série "Em risco" (abaixo do ponto) */}
      {riskPoints.map(([x, y], i) => (
        <g key={`r-${i}`}>
          <circle cx={x} cy={y} r={2.5} fill="hsl(var(--destructive))" />
          <text x={x} y={y + 14} textAnchor="middle" fontSize={9} fontWeight={600} fill="hsl(var(--destructive))" style={{ fontVariantNumeric: "tabular-nums" }}>
            {compact(risk[i])}
          </text>
        </g>
      ))}
      {/* x labels */}
      {data.map((_, i) => {
        const x = pad + i * stepX;
        const monthsPt = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        let label: string;
        if (months && months[i]) {
          const mo = parseInt(months[i].split("-")[1] ?? "1", 10);
          label = monthsPt[mo - 1] ?? "";
        } else {
          const idx = (new Date().getMonth() - (data.length - 1 - i) + 12) % 12;
          label = monthsPt[idx];
        }
        return (
          <text key={i} x={x} y={height - 8} textAnchor="middle" fontSize={10} fill="hsl(var(--muted-foreground))">
            {label}
          </text>
        );
      })}
    </svg>
  );
}

type AnalystRow = { user_id: string; name: string; initials: string; valor: number };
type CompanyRow = { id: string; name: string; itens: number; valor: number; status: string; tone: "success" | "warning" | "destructive" };
type AlertRow = { id: string; kind: string; title: string; meta: string; time: string; tone: "amber" | "muted" };
type FunnelStep = { key: string; count: number; valor: number };
type Metrics = {
  autoPct: number | null;
  autoLabel: string;
  valorRisco: number;
  lotesCriticos: number;
  riscoPctDoTotal: number | null;
  deltaPct: number | null;
  cicloDias: number | null;
  cicloDeltaDias: number | null;
  itensAprovPct: number | null;
  itensAprovTexto: string;
  glosasTotal: number;
  glosasCount: number;
  funil: Record<"validacao" | "em_analise" | "aprovacao_dir" | "pos_nf" | "pago", FunnelStep>;
};

const STATUS_TONE: Record<string, { label: string; tone: "success" | "warning" | "destructive" }> = {
  pago: { label: "Pago", tone: "success" },
  aprovado: { label: "Aprovado", tone: "success" },
  aprovado_em_revisao: { label: "Aprovado", tone: "success" },
  nf_recebida: { label: "NF recebida", tone: "success" },
  nf_conciliada: { label: "NF conciliada", tone: "success" },
  aguardando_validacao: { label: "Em análise", tone: "warning" },
  aguardando_aprovacao: { label: "Em análise", tone: "warning" },
  em_analise_ia: { label: "Em análise", tone: "warning" },
  revisao_analista: { label: "Em análise", tone: "warning" },
  devolvido_analista: { label: "Risco", tone: "destructive" },
  nf_questionada: { label: "Risco", tone: "destructive" },
  rejeitado: { label: "Risco", tone: "destructive" },
};

const ALERT_KIND_TITLE: Record<string, string> = {
  duplicidade_exata: "Duplicidade de atendimento",
  sobreposicao_assistencial: "Sobreposição assistencial",
  duplicidade_tuss_paciente: "Duplicidade TUSS/paciente",
};

const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
};

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

export default function BiDiretoria() {
  const [period, setPeriod] = useState<Period>("mes");
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<any[]>([]);
  const [monthly, setMonthly] = useState<{ month: string; valor: number; risco: number }[]>([]);
  const [analysts, setAnalysts] = useState<AnalystRow[]>([]);
  const [topCompanies, setTopCompanies] = useState<CompanyRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [patternCoverage, setPatternCoverage] = useState<{ total: number; linked: number; pct: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_pattern_coverage" as never, { p_months: 1 } as never);
      if (error) { setPatternCoverage(null); return; }
      const rows = ((data ?? []) as Array<{ total_batches: number; linked_batches: number; coverage_pct: number }>);
      const row = rows[rows.length - 1];
      if (!row) { setPatternCoverage({ total: 0, linked: 0, pct: 0 }); return; }
      setPatternCoverage({ total: Number(row.total_batches), linked: Number(row.linked_batches), pct: Number(row.coverage_pct) });
    })();
  }, []);



  const now = new Date();
  const competenciaLabel = `${MONTHS_PT_FULL[now.getMonth()]} ${now.getFullYear()}`;

  useEffect(() => {
    document.title = "BI · Diretoria | Exacta";
    (async () => {
      try {
        const since = new Date();
        since.setMonth(since.getMonth() - 12);
        const { data } = await supabase
          .from("payments")
          .select("id, status, total_amount, liquido_total, items_count, competence_month, created_at, created_by")
          .gte("created_at", since.toISOString())
          .not("status", "in", '("cancelado","rascunho")')
          .order("created_at", { ascending: false });
        const paymentsList = data ?? [];
        setPayments(paymentsList);

        // Série mensal: processado × em risco (por competência)
        const map: Record<string, { valor: number; risco: number }> = {};
        for (const p of paymentsList) {
          const m = (p.competence_month ?? "").slice(0, 7);
          if (!m) continue;
          if (!map[m]) map[m] = { valor: 0, risco: 0 };
          const v = Number(p.liquido_total ?? p.total_amount ?? 0);
          map[m].valor += v;
          if (["devolvido_analista", "nf_questionada", "rejeitado", "revisao_analista"].includes(p.status)) {
            map[m].risco += v;
          }
        }
        setMonthly(
          Object.entries(map)
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-6)
            .map(([month, agg]) => ({ month, valor: agg.valor, risco: agg.risco })),
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);


  // ---- Métricas derivadas ----
  const monthsBack = PERIOD_MONTHS[period];
  const periodFloor = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - monthsBack + 1);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [monthsBack]);

  const inPeriod = useMemo(
    () => payments.filter((p) => new Date(p.created_at) >= periodFloor),
    [payments, periodFloor],
  );

  // Analistas: soma liquido dos lotes por created_by no período + full_name via profiles.
  // Restringe a usuários com role 'analista' ou 'admin' para não classificar
  // médicos/validadores/diretores como analistas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const byUser = new Map<string, number>();
      for (const p of inPeriod) {
        if (!p.created_by) continue;
        const v = Number(p.liquido_total ?? p.total_amount ?? 0);
        byUser.set(p.created_by, (byUser.get(p.created_by) ?? 0) + v);
      }
      if (byUser.size === 0) {
        if (!cancelled) setAnalysts([]);
        return;
      }
      const ids = Array.from(byUser.keys());
      const [{ data: profs }, { data: roleRows }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email").in("id", ids),
        supabase.from("user_roles").select("user_id, role").in("user_id", ids),
      ]);
      const allowedRoles = new Set(["analista", "admin"]);
      const allowed = new Set(
        (roleRows ?? []).filter((r: any) => allowedRoles.has(r.role)).map((r: any) => r.user_id),
      );
      const nameById = new Map<string, string>(
        (profs ?? []).map((p: any) => [p.id, p.full_name || p.email || "Usuário"]),
      );
      const rows: AnalystRow[] = ids
        .filter((id) => allowed.has(id))
        .map((id) => {
          const name = nameById.get(id) ?? "Usuário";
          return { user_id: id, name, initials: initialsOf(name), valor: byUser.get(id) ?? 0 };
        })
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 4);
      if (!cancelled) setAnalysts(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [inPeriod]);

  // Top empresas: agrega gross_amount por empresa nos lotes do período.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = inPeriod.map((p) => p.id);
      if (!ids.length) {
        if (!cancelled) setTopCompanies([]);
        return;
      }
      const { data } = await supabase
        .from("payment_items")
        .select("company_id, company_name, gross_amount, payment_id")
        .in("payment_id", ids)
        .neq("is_cancelled", true)
        .limit(50000);
      const statusByPayment = new Map<string, string>(inPeriod.map((p) => [p.id, p.status]));
      const agg = new Map<string, { name: string; itens: number; valor: number; statuses: Record<string, number> }>();
      for (const it of (data as any[]) ?? []) {
        const key = it.company_id || it.company_name || "—";
        const name = it.company_name || "Sem empresa";
        const entry = agg.get(key) ?? { name, itens: 0, valor: 0, statuses: {} };
        entry.itens += 1;
        entry.valor += Number(it.gross_amount ?? 0);
        const s = statusByPayment.get(it.payment_id) ?? "—";
        entry.statuses[s] = (entry.statuses[s] ?? 0) + 1;
        agg.set(key, entry);
      }
      const rows: CompanyRow[] = Array.from(agg.entries())
        .map(([id, e]) => {
          // Status dominante entre os itens da empresa
          const dominant = Object.entries(e.statuses).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "—";
          const meta = STATUS_TONE[dominant] ?? { label: "—", tone: "warning" as const };
          return { id, name: e.name, itens: e.itens, valor: e.valor, status: meta.label, tone: meta.tone };
        })
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 5);
      if (!cancelled) setTopCompanies(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [inPeriod]);

  // Alertas assistenciais: busca direto em payment_items no período (RLS filtra por hospital ativo).
  // Não depende da lista de payments (que pode não ter carregado ainda ou ser truncada).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("payment_items")
        .select("id, validation_findings, sector, company_name, created_at, payment_id")
        .not("validation_findings", "is", null)
        .neq("validation_findings", "[]")
        .gte("created_at", periodFloor.toISOString())
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) {
        console.error("[BI] alertas assistenciais falhou:", error);
        if (!cancelled) setAlerts([]);
        return;
      }
      const out: AlertRow[] = [];
      const seen = new Set<string>();
      for (const row of (data as any[]) ?? []) {
        const findings = Array.isArray(row.validation_findings) ? row.validation_findings : [];
        for (const f of findings) {
          const kind: string = f?.kind ?? f?.type ?? "";
          if (!["duplicidade_exata", "sobreposicao_assistencial", "duplicidade_tuss_paciente"].includes(kind)) continue;
          const key = `${row.id}-${kind}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            id: key,
            kind,
            title: ALERT_KIND_TITLE[kind] ?? f?.rule_name ?? "Alerta",
            meta: [row.sector || row.company_name, f?.message]
              .filter(Boolean)
              .join(" · ")
              .slice(0, 140),
            time: relativeTime(f?.detected_at ?? row.created_at),
            tone: kind === "sobreposicao_assistencial" ? "amber" : "muted",
          });
          if (out.length >= 6) break;
        }
        if (out.length >= 6) break;
      }
      if (!cancelled) setAlerts(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodFloor]);

  const totalEmAprovacao = useMemo(
    () =>
      inPeriod
        .filter((p) =>
          ["em_analise_ia", "revisao_analista", "aguardando_validacao", "aguardando_aprovacao", "devolvido_analista"].includes(p.status),
        )
        .reduce((a, p) => a + Number(p.liquido_total ?? p.total_amount ?? 0), 0),
    [inPeriod],
  );
  const lotesAtivos = useMemo(
    () =>
      inPeriod.filter((p) =>
        ["em_analise_ia", "revisao_analista", "aguardando_validacao", "aguardando_aprovacao", "devolvido_analista"].includes(p.status),
      ).length,
    [inPeriod],
  );
  const pagoNoMes = useMemo(
    () => inPeriod.filter((p) => p.status === "pago").reduce((a, p) => a + Number(p.liquido_total ?? p.total_amount ?? 0), 0),
    [inPeriod],
  );
  const lotesEncerrados = useMemo(() => inPeriod.filter((p) => ["pago", "aprovado", "nf_recebida"].includes(p.status)).length, [inPeriod]);
  const totalLotes = inPeriod.length || 1;
  const taxaAprov = Math.round((lotesEncerrados / totalLotes) * 100);

  // ---- Métricas reais (KPIs / funil / lote crítico / glosas) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (inPeriod.length === 0) {
        if (!cancelled) setMetrics(null);
        return;
      }
      const ids = inPeriod.map((p) => p.id);

      // Comparação com período anterior (mesmo comprimento)
      const prevSince = new Date(periodFloor);
      prevSince.setMonth(prevSince.getMonth() - monthsBack);
      const prevUntil = new Date(periodFloor);
      const { data: prevPays } = await (supabase as any)
        .from("payments")
        .select("liquido_total, total_amount, status")
        .gte("created_at", prevSince.toISOString())
        .lt("created_at", prevUntil.toISOString())
        .not("status", "in", '("cancelado","rascunho")');
      const prevTotal = (prevPays ?? [])
        .filter((p: any) =>
          ["em_analise_ia", "revisao_analista", "aguardando_validacao", "aguardando_aprovacao", "devolvido_analista"].includes(p.status),
        )
        .reduce((a: number, p: any) => a + Number(p.liquido_total ?? p.total_amount ?? 0), 0);
      const deltaPct = prevTotal > 0 ? ((totalEmAprovacao - prevTotal) / prevTotal) * 100 : null;

      // Valor em risco: lotes precisam de intervenção humana ou têm bloqueio
      const RISCO = ["devolvido_analista", "rejeitado", "nf_questionada", "revisao_analista"];
      const valorRisco = inPeriod
        .filter((p) => RISCO.includes(p.status))
        .reduce((a, p) => a + Number(p.liquido_total ?? p.total_amount ?? 0), 0);
      const lotesCriticos = inPeriod.filter((p) => RISCO.includes(p.status)).length;
      const totalLiquido = inPeriod.reduce((a, p) => a + Number(p.liquido_total ?? p.total_amount ?? 0), 0);
      const riscoPctDoTotal = totalLiquido > 0 ? (valorRisco / totalLiquido) * 100 : null;

      // Aprovação automática (Motor de Regras): considera manual QUALQUER lote com sinais
      // de intervenção humana — não só devolução de status. Motivo: intervenções em massa
      // (ajustes financeiros, glosas acatadas, marcações de caso especial, edição de itens)
      // acontecem sem trocar o status para devolvido_analista, então usar só o histórico
      // superestima o "automático".
      const touched = new Set<string>();
      const [histRes, itemsRes, marksRes, adjRes] = await Promise.all([
        (supabase as any)
          .from("payment_status_history")
          .select("payment_id")
          .in("payment_id", ids)
          .in("new_status", ["devolvido_analista", "revisao_analista"]),
        (supabase as any)
          .from("payment_items")
          .select("payment_id")
          .in("payment_id", ids)
          .in("ai_status", ["acatado", "reprovado", "alerta"]),
        (supabase as any).from("special_case_marks").select("payment_id").in("payment_id", ids),
        (supabase as any).from("company_financial_adjustments").select("payment_id").in("payment_id", ids),
      ]);
      for (const src of [histRes.data, itemsRes.data, marksRes.data, adjRes.data]) {
        for (const r of (src ?? []) as Array<{ payment_id?: string | null }>) {
          if (r.payment_id) touched.add(r.payment_id);
        }
      }
      const finalizados = inPeriod.filter((p) =>
        ["pago", "aprovado", "nf_recebida", "nf_conciliada", "aguardando_validacao", "aguardando_aprovacao"].includes(p.status),
      );
      const auto = finalizados.filter((p) => !touched.has(p.id)).length;
      const autoPct = finalizados.length > 0 ? Math.round((auto / finalizados.length) * 100) : null;

      // Ciclo médio: created_at → approved_at nos lotes aprovados/pagos do período
      const { data: cycleRows } = await supabase
        .from("payments")
        .select("created_at, approved_at, status")
        .in("id", ids)
        .not("approved_at", "is", null);
      const durs = (cycleRows ?? []).map(
        (r: any) => (new Date(r.approved_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000,
      );
      const cicloDias = durs.length > 0 ? durs.reduce((a, b) => a + b, 0) / durs.length : null;

      // Ciclo período anterior (para delta)
      const { data: prevCycle } = await supabase
        .from("payments")
        .select("created_at, approved_at")
        .gte("created_at", prevSince.toISOString())
        .lt("created_at", prevUntil.toISOString())
        .not("approved_at", "is", null);
      const prevDurs = (prevCycle ?? []).map(
        (r: any) => (new Date(r.approved_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000,
      );
      const prevCiclo = prevDurs.length > 0 ? prevDurs.reduce((a, b) => a + b, 0) / prevDurs.length : null;
      const cicloDeltaDias = cicloDias !== null && prevCiclo !== null ? prevCiclo - cicloDias : null;

      // Itens aprovados: último lote encerrado do período
      const ultimo = [...finalizados].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )[0];
      let itensAprovPct: number | null = null;
      let itensAprovTexto = "";
      if (ultimo) {
        const { data: itens } = await supabase
          .from("payment_items")
          .select("is_cancelled")
          .eq("payment_id", ultimo.id);
        const total = itens?.length ?? 0;
        const aprov = (itens ?? []).filter((i: any) => !i.is_cancelled).length;
        if (total > 0) {
          itensAprovPct = (aprov / total) * 100;
          itensAprovTexto = `${aprov} de ${total} itens · último lote`;
        }
      }

      // Glosas registradas no período
      const { data: glosas } = await supabase
        .from("glosa_debts")
        .select("total_debt")
        .gte("created_at", periodFloor.toISOString());
      const glosasTotal = (glosas ?? []).reduce((a: number, g: any) => a + Number(g.total_debt ?? 0), 0);
      const glosasCount = glosas?.length ?? 0;

      // Funil de aprovação (valor por etapa)
      const bucket = (statuses: string[]) => {
        const rows = inPeriod.filter((p) => statuses.includes(p.status));
        return {
          key: statuses[0],
          count: rows.length,
          valor: rows.reduce((a, p) => a + Number(p.liquido_total ?? p.total_amount ?? 0), 0),
        };
      };
      const funil = {
        validacao: bucket(["aguardando_validacao"]),
        em_analise: bucket(["em_analise_ia", "revisao_analista", "devolvido_analista"]),
        aprovacao_dir: bucket(["aguardando_aprovacao"]),
        pos_nf: bucket(["aprovado", "aprovado_em_revisao", "nf_recebida", "nf_conciliada"]),
        pago: bucket(["pago"]),
      };

      if (cancelled) return;
      setMetrics({
        autoPct,
        autoLabel: autoPct === null ? "—" : `${autoPct}%`,
        valorRisco,
        lotesCriticos,
        riscoPctDoTotal,
        deltaPct,
        cicloDias,
        cicloDeltaDias,
        itensAprovPct,
        itensAprovTexto,
        glosasTotal,
        glosasCount,
        funil,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [inPeriod, periodFloor, monthsBack, totalEmAprovacao]);

  // Fallback estático quando ainda carregando ou base vazia (mantém o visual do mockup)
  const useFallback = loading || inPeriod.length === 0;
  const display = useFallback
    ? {
        totalAprov: 1_917_832,
        lotesAtivos: 4,
        periodoLabel: "abril–junho/2026",
        pago: 1_200_000,
        encerrados: 38,
        taxa: 95.5,
        autoPct: 87,
        valorRisco: 7619,
        deltaPct: 8.2,
        spark: [800_000, 850_000, 900_000, 1_100_000, 1_400_000, 1_700_000, 1_920_000],
      }
    : {
        totalAprov: totalEmAprovacao,
        lotesAtivos,
        periodoLabel: competenciaLabel.toLowerCase(),
        pago: pagoNoMes,
        encerrados: lotesEncerrados,
        taxa: taxaAprov,
        autoPct: metrics?.autoPct ?? 0,
        valorRisco: metrics?.valorRisco ?? 0,
        deltaPct: metrics?.deltaPct ?? 0,
        spark: monthly.map((m) => m.valor),
      };

  return (
    <div className="container mx-auto px-3 sm:px-4 py-4 sm:py-6 max-w-[1400px] space-y-4 sm:space-y-6">
      {/* ===== Header ===== */}
      <PageHeader
        title="BI · Diretoria"
        description={`Visão consolidada · competência ${competenciaLabel.toLowerCase()}`}
        actions={
          <>
            <div className="inline-flex rounded-full bg-muted/60 p-1 max-w-full overflow-x-auto no-scrollbar">
              {(["semana", "mes", "trimestre", "ano"] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-medium rounded-full transition-colors whitespace-nowrap ${
                    period === p ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {p === "mes" ? "Mês" : p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
            <button className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm text-foreground hover:bg-muted/40 transition-colors whitespace-nowrap">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {MONTHS_PT_FULL[now.getMonth()]} {now.getFullYear()}
            </button>
          </>
        }
      />


      {/* ===== Faixa narrativa ===== */}
      <div className="rounded-2xl bg-card border border-border px-5 sm:px-8 py-5 sm:py-6 shadow-sm">
        <p className="text-center text-[14px] sm:text-[15px] leading-relaxed text-foreground">
          Em {MONTHS_PT_FULL[now.getMonth()].toLowerCase()},{" "}
          <strong className="font-semibold">{fmtMi(display.totalAprov)}</strong> passaram pelo Exacta
          {metrics?.autoPct !== null && metrics?.autoPct !== undefined ? (
            <>
              {" "}—{" "}
              <span className="text-primary font-medium">
                {metrics.autoPct}% aprovados automaticamente pelo Motor de Regras
              </span>
            </>
          ) : null}
          {metrics?.cicloDias !== null && metrics?.cicloDias !== undefined ? (
            <>
              . Ciclo médio de{" "}
              <strong className="font-semibold">
                {metrics.cicloDias.toFixed(1).replace(".", ",")} {metrics.cicloDias >= 2 ? "dias" : "dia"}
              </strong>
            </>
          ) : null}
          .{" "}
          {metrics && metrics.valorRisco > 0 ? (
            <span className="text-destructive font-medium">
              {fmtFull(metrics.valorRisco)} em risco aguardam revisão manual.
            </span>
          ) : null}
        </p>
      </div>


      {/* ===== Hero grid: card azul + donut IA ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Card azul */}
        <div
          className="lg:col-span-8 rounded-2xl p-5 sm:p-8 text-primary-foreground relative overflow-hidden shadow-lg"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.92) 60%, hsl(var(--primary) / 0.85) 100%)",
          }}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-[0.12em] uppercase opacity-80">Total em aprovação</div>
              <div
                className="mt-2 sm:mt-3 text-3xl sm:text-5xl md:text-6xl font-light tracking-tight break-words"
                style={{ fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}
              >
                {fmtFull(display.totalAprov).replace("R$\u00a0", "R$ ")}
              </div>
              <div className="mt-2 text-xs sm:text-sm opacity-80">
                {display.lotesAtivos} lotes ativos · {display.periodoLabel}
              </div>
            </div>
            {metrics?.deltaPct !== null && metrics?.deltaPct !== undefined ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-semibold backdrop-blur-sm whitespace-nowrap">
                <TrendingUp className="h-3.5 w-3.5" />
                {metrics.deltaPct >= 0 ? "+" : ""}{metrics.deltaPct.toFixed(1).replace(".", ",")}% vs período anterior
              </span>
            ) : null}
          </div>

          {/* mini-tiles */}
          <div className="mt-5 sm:mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { label: "Pago no mês", value: fmtMi(display.pago) },
              { label: "Lotes encerrados", value: String(display.encerrados) },
              { label: "Taxa de aprovação", value: `${typeof display.taxa === "number" ? display.taxa.toFixed(1).replace(".", ",") : display.taxa}%` },
            ].map((t) => (
              <div key={t.label} className="rounded-xl bg-white/12 backdrop-blur-sm px-2.5 sm:px-4 py-2.5 sm:py-3 min-w-0">
                <div className="text-base sm:text-2xl font-semibold tracking-tight truncate" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {t.value}
                </div>
                <div className="text-[10px] sm:text-[11px] opacity-80 mt-0.5">{t.label}</div>
              </div>
            ))}
          </div>


          {/* sparkline */}
          <div className="mt-6 relative">
            <HeroSparkline data={display.spark} />
            <div
              className="absolute -top-2 right-4 rounded-md bg-foreground text-background px-2.5 py-1 text-xs font-semibold"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {fmtCompact(display.spark[display.spark.length - 1] ?? 0).replace("R$ ", "R$ ")}
            </div>
            <div className="flex justify-between mt-2 text-[10px] opacity-70 px-6">
              {(monthly.length ? monthly : Array.from({ length: 6 }, (_, i) => ({ month: `2026-0${i + 1}` }))).map((m: any) => {
                const [, mo] = (m.month ?? "").split("-");
                return (
                  <span key={m.month} className="capitalize">
                    {MONTHS_PT[parseInt(mo ?? "1") - 1]}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card donut */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="rounded-2xl bg-card border border-border p-6 shadow-sm flex flex-col items-center">
            <div className="w-full text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Aprovação automática · Motor de Regras
            </div>
            <div className="my-4">
              <Donut pct={display.autoPct} />
            </div>
            <div className="w-full space-y-2 mt-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  Automático (Motor de Regras)
                </span>
                <span className="font-semibold tabular-nums">{display.autoPct}%</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
                  Revisão manual
                </span>
                <span className="font-semibold tabular-nums">{100 - display.autoPct}%</span>
              </div>
            </div>
          </div>

          {metrics && metrics.lotesCriticos > 0 ? (
            <Link
              to="/pagamentos?filter=risco"
              className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 flex items-center gap-3 hover:bg-destructive/15 transition-colors"
            >
              <div className="h-10 w-10 rounded-xl bg-destructive/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-destructive">
                  {metrics.lotesCriticos} {metrics.lotesCriticos === 1 ? "lote crítico" : "lotes críticos"}
                </div>
                <div className="text-xs text-destructive/80 mt-0.5">
                  {fmtFull(metrics.valorRisco)} aguardando revisão
                </div>
              </div>
              <span className="inline-flex items-center rounded-full bg-destructive text-destructive-foreground px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
                Urgente
              </span>
            </Link>
          ) : (
            <div className="rounded-2xl border border-success/30 bg-success/10 p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-success/15 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-success">Nenhum lote em risco</div>
                <div className="text-xs text-success/80 mt-0.5">Fluxo em dia neste período</div>
              </div>
            </div>
          )}
        </div>
      </div>


      {/* ===== Linha de 4 KPIs ===== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Valor em risco */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-sm">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Valor em risco</div>
          <div className="mt-3 text-4xl font-light tracking-tight text-destructive tabular-nums">
            {fmtFull(metrics?.valorRisco ?? 0)}
          </div>
          <div className="mt-4 text-xs text-muted-foreground min-h-[1.25rem]">
            {metrics && metrics.riscoPctDoTotal !== null ? (
              <>
                <span className="font-semibold text-foreground">
                  {metrics.riscoPctDoTotal.toFixed(1).replace(".", ",")}%
                </span>{" "}
                do total ·{" "}
                <span className="font-semibold text-foreground">
                  {metrics.lotesCriticos} {metrics.lotesCriticos === 1 ? "lote crítico" : "lotes críticos"}
                </span>
              </>
            ) : (
              "Sem dados no período"
            )}
          </div>
        </div>

        {/* Ciclo médio */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-sm">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Ciclo médio</div>
          {metrics?.cicloDias !== null && metrics?.cicloDias !== undefined ? (
            <>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-4xl font-light tracking-tight text-foreground tabular-nums">
                  {metrics.cicloDias.toFixed(1).replace(".", ",")}
                </span>
                <span className="text-base text-muted-foreground">
                  {metrics.cicloDias >= 2 ? "dias" : "dia"}
                </span>
              </div>
              {metrics.cicloDeltaDias !== null && metrics.cicloDeltaDias !== undefined ? (
                <div className="mt-4">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      metrics.cicloDeltaDias >= 0
                        ? "bg-success/15 text-success"
                        : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    <TrendingUp className="h-3 w-3" />
                    {Math.abs(metrics.cicloDeltaDias).toFixed(1).replace(".", ",")}d{" "}
                    {metrics.cicloDeltaDias >= 0 ? "mais rápido" : "mais lento"}
                  </span>
                </div>
              ) : null}
              <div className="mt-3 text-xs text-muted-foreground">
                Da criação à <span className="font-semibold text-foreground">aprovação</span>
              </div>
            </>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Sem lotes aprovados no período</div>
          )}
        </div>

        {/* Itens aprovados */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-sm">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Itens aprovados</div>
          {metrics?.itensAprovPct !== null && metrics?.itensAprovPct !== undefined ? (
            <>
              <div className="mt-3 text-4xl font-light tracking-tight text-foreground tabular-nums">
                {metrics.itensAprovPct.toFixed(1).replace(".", ",")}%
              </div>
              <div className="mt-3 text-xs text-muted-foreground">{metrics.itensAprovTexto}</div>
            </>
          ) : (
            <div className="mt-3 text-sm text-muted-foreground">Sem itens no período</div>
          )}
        </div>

        {/* Glosas */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-sm">
          <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Glosas registradas</div>
          <div className="mt-3 text-4xl font-light tracking-tight text-foreground tabular-nums">
            {fmtFull(metrics?.glosasTotal ?? 0)}
          </div>
          <div className="mt-4">
            {metrics && metrics.glosasCount === 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 text-success px-2.5 py-1 text-xs font-medium">
                Zero glosas
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning px-2.5 py-1 text-xs font-medium">
                {metrics?.glosasCount ?? 0} {metrics?.glosasCount === 1 ? "glosa" : "glosas"}
              </span>
            )}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            {metrics?.glosasCount ?? 0} divergências de conciliação neste período
          </div>
        </div>
      </div>


      {/* ===== Funil de aprovação ===== */}
      <div className="rounded-2xl bg-card border border-border p-6 shadow-sm">
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Funil de aprovação</div>
            <div className="mt-1 text-sm text-muted-foreground">
              valor em cada etapa · {display.lotesAtivos} lotes ativos
            </div>
          </div>
          <Link to="/pagamentos" className="text-sm font-medium text-primary hover:underline">
            Ver detalhes ›
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-stretch">
          {(() => {
            const f = metrics?.funil;
            const maxValor = f
              ? Math.max(f.validacao.valor, f.em_analise.valor, f.aprovacao_dir.valor, f.pos_nf.valor, f.pago.valor, 1)
              : 1;
            const pctOf = (v: number) => (maxValor > 0 ? Math.max(4, Math.round((v / maxValor) * 100)) : 0);
            return [
              { label: "Validação", count: f?.validacao.count ?? 0, valor: fmtFull(f?.validacao.valor ?? 0), pct: pctOf(f?.validacao.valor ?? 0), tone: "info" },
              { label: "Em análise", count: f?.em_analise.count ?? 0, valor: fmtFull(f?.em_analise.valor ?? 0), pct: pctOf(f?.em_analise.valor ?? 0), tone: "info" },
              { label: "Aprovação dir.", count: f?.aprovacao_dir.count ?? 0, valor: fmtFull(f?.aprovacao_dir.valor ?? 0), pct: pctOf(f?.aprovacao_dir.valor ?? 0), tone: "info" },
              { label: "Pós-aprov. NF", count: f?.pos_nf.count ?? 0, valor: fmtFull(f?.pos_nf.valor ?? 0), pct: pctOf(f?.pos_nf.valor ?? 0), tone: (f?.pos_nf.count ?? 0) === 0 ? "muted" : "info" },
              { label: "Pago", count: f?.pago.count ?? 0, valor: fmtFull(f?.pago.valor ?? 0), pct: 100, tone: "success" },
            ];
          })().map((step, i, arr) => {
            const isPago = step.tone === "success";
            const isMuted = step.tone === "muted";
            const accent = isPago
              ? "hsl(var(--success))"
              : isMuted
              ? "hsl(var(--muted-foreground) / 0.4)"
              : "hsl(var(--primary))";
            return (
              <div key={step.label} className="relative">
                <div className="rounded-xl bg-muted/30 border border-border/60 p-4 h-full flex flex-col">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
                    {step.label}
                  </div>
                  <div
                    className={`mt-3 text-3xl font-light tracking-tight tabular-nums ${
                      isPago ? "text-success" : isMuted ? "text-muted-foreground" : "text-foreground"
                    }`}
                  >
                    {step.count}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{step.valor}</div>
                  <div className="mt-3 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${step.pct}%`, background: accent }} />
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <ChevronRight className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/40 z-10" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ===== Evolução mensal + Por analista ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Evolução mensal</div>
              <div className="mt-1 text-sm text-muted-foreground">processado vs. em risco · 6 meses</div>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-2 text-foreground">
                <span className="h-0.5 w-5 bg-primary rounded-full" /> Processado
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-0.5 w-5 rounded-full"
                  style={{ background: "repeating-linear-gradient(to right, hsl(var(--destructive)) 0 4px, transparent 4px 8px)" }}
                />{" "}
                Em risco
              </span>
            </div>
          </div>
          <EvolutionChart
            data={(monthly.length ? monthly.map((m) => m.valor) : display.spark) as number[]}
            riskData={monthly.length ? monthly.map((m) => m.risco) : undefined}
            months={monthly.length ? monthly.map((m) => m.month) : undefined}
          />
        </div>

        <div className="rounded-2xl bg-card border border-border p-6 shadow-sm">
          <div>
            <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Por analista</div>
            <div className="mt-1 text-sm text-muted-foreground">
              valor revisado · {competenciaLabel.toLowerCase()}
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {analysts.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Sem lotes criados por analistas no período.
              </div>
            ) : (
              (() => {
                const max = Math.max(...analysts.map((a) => a.valor), 1);
                return analysts.map((a) => {
                  const pct = Math.round((a.valor / max) * 100);
                  return (
                    <div key={a.user_id} className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 bg-primary/15 text-primary">
                        {a.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{a.name}</div>
                        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold text-foreground tabular-nums">{fmtMi(a.valor)}</div>
                        <div className="text-[10px] text-muted-foreground tabular-nums">{pct}%</div>
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      </div>


      {/* ===== Top empresas + Alertas assistenciais ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl bg-card border border-border p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Top empresas</div>
            <Link to="/empresas" className="text-sm font-medium text-primary hover:underline">
              Ver todas ›
            </Link>
          </div>
          <div className="grid grid-cols-12 gap-2 text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground pb-2 border-b border-border">
            <div className="col-span-4">Empresa</div>
            <div className="col-span-1 text-right">Itens</div>
            <div className="col-span-3">Volume</div>
            <div className="col-span-2 text-right">Valor líq.</div>
            <div className="col-span-2 text-right">Status</div>
          </div>
          {topCompanies.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Sem empresas com itens processados no período.
            </div>
          ) : (
            (() => {
              const maxValor = Math.max(...topCompanies.map((r) => r.valor), 1);
              return topCompanies.map((row) => {
                const pct = Math.round((row.valor / maxValor) * 100);
                const toneClass =
                  row.tone === "success"
                    ? "bg-success/15 text-success"
                    : row.tone === "warning"
                    ? "bg-amber-500/15 text-amber-600"
                    : "bg-destructive/15 text-destructive";
                return (
                  <div key={row.id} className="grid grid-cols-12 gap-2 items-center py-3 border-b border-border last:border-0 text-sm">
                    <div className="col-span-4 text-foreground truncate" title={row.name}>{row.name}</div>
                    <div className="col-span-1 text-right text-foreground tabular-nums">{row.itens}</div>
                    <div className="col-span-3">
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="col-span-2 text-right text-foreground tabular-nums">
                      {row.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
                    </div>
                    <div className="col-span-2 text-right">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneClass}`}>{row.status}</span>
                    </div>
                  </div>
                );
              });
            })()
          )}
        </div>


        <div className="rounded-2xl bg-card border border-border p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Alertas assistenciais</div>
            <span className="inline-flex items-center rounded-full bg-destructive/15 text-destructive px-2.5 py-1 text-xs font-semibold">
              {alerts.length} {alerts.length === 1 ? "aberto" : "abertos"}
            </span>
          </div>
          <div className="space-y-3">
            {alerts.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Nenhum alerta assistencial no período.
              </div>
            ) : (
              alerts.map((a) => {
                const Icon = a.kind === "sobreposicao_assistencial" ? AlertCircle : Search;
                const bubble = a.tone === "amber"
                  ? "bg-amber-500/15 text-amber-600"
                  : "bg-muted text-muted-foreground";
                return (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bubble}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-sm font-semibold text-foreground">{a.title}</div>
                        <div className="text-[11px] text-muted-foreground flex-shrink-0">{a.time}</div>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate" title={a.meta}>{a.meta}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

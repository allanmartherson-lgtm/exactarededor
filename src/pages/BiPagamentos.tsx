import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search,
  Filter,
  Download,
  ChevronRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";

/**
 * BI · Pagamentos — lista executiva (Apple-style) ligada aos dados reais.
 * Lê de `payments` + nome do analista em `profiles`.
 * Não substitui /pagamentos (Payments.tsx).
 */

const fmtMi = (v: number) => {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return formatCurrency(v);
};
const fmtFull = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type UiStatus = "pago" | "aprovado" | "em_aprovacao" | "em_analise" | "risco";

type Row = {
  id: string;
  lote: string;            // reference
  empresa: string;         // empresa principal do lote
  competencia: string;     // "Mai/26"
  itens: number;
  valor: number;           // liquido_total
  diferenca: number;       // bruto-liquido
  ciclo: string;
  status: UiStatus;
  analista: string;
};

const STATUS_MAP: Record<string, UiStatus> = {
  pago: "pago",
  aprovado: "aprovado",
  nf_recebida: "aprovado",
  aguardando_aprovacao: "em_aprovacao",
  aguardando_validacao: "em_analise",
  em_validacao: "em_analise",
  em_analise_ia: "em_analise",
  revisao_analista: "em_analise",
  devolvido_analista: "risco",
};

const STATUS_META: Record<UiStatus, { label: string; tone: string; dot: string }> = {
  pago: { label: "Pago", tone: "bg-success/10 text-success border-success/20", dot: "bg-success" },
  aprovado: { label: "Aprovado", tone: "bg-primary/10 text-primary border-primary/20", dot: "bg-primary" },
  em_aprovacao: { label: "Em aprovação", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20", dot: "bg-amber-500" },
  em_analise: { label: "Em análise", tone: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
  risco: { label: "Em risco", tone: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
};

const MONTHS_PT_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function fmtCompetencia(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS_PT_SHORT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}
function daysBetween(a?: string | null, b?: string | null): string {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  const d = ms / 86_400_000;
  return `${d.toFixed(1).replace(".", ",")} d`;
}
function shortenRef(ref: string | null): string {
  if (!ref) return "";
  // pega últimos 12 chars úteis pra exibir como código curto
  const cleaned = ref.replace(/\s+/g, " ").trim();
  return cleaned.length > 36 ? cleaned.slice(0, 33) + "…" : cleaned;
}

// ---------- mini bar chart ----------
function MiniBars({ values, color = "hsl(var(--primary))" }: { values: number[]; color?: string }) {
  const max = Math.max(...values, 1);
  return (
    <svg viewBox="0 0 120 36" className="w-full h-9">
      {values.map((v, i) => {
        const h = (v / max) * 30;
        return (
          <rect
            key={i}
            x={i * 14 + 2}
            y={32 - h}
            width={10}
            height={h}
            rx={2}
            fill={color}
            opacity={i === values.length - 1 ? 1 : 0.35}
          />
        );
      })}
    </svg>
  );
}

export default function BiPagamentos() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | UiStatus>("all");

  useEffect(() => {
    document.title = "BI · Pagamentos | Exacta";
    (async () => {
      try {
        // 1) últimos pagamentos
        const { data: payments } = await supabase
          .from("payments")
          .select("id, reference, status, competence_month, bruto_total, liquido_total, items_count, created_by, created_at, approved_at, validated_at")
          .eq("is_test", false)
          .order("created_at", { ascending: false })
          .limit(40);

        const list = payments ?? [];
        if (list.length === 0) {
          setRows([]);
          return;
        }

        // 2) nomes dos analistas
        const userIds = Array.from(new Set(list.map((p: any) => p.created_by).filter(Boolean)));
        let analystByUser: Record<string, string> = {};
        if (userIds.length) {
          const { data: profs } = await supabase
            .from("profiles")
            .select("id, full_name, email")
            .in("id", userIds);
          analystByUser = Object.fromEntries(
            (profs ?? []).map((p: any) => [p.id, p.full_name || p.email || "—"]),
          );
        }

        // 3) empresa principal de cada lote
        const paymentIds = list.map((p: any) => p.id);
        const { data: groups } = await supabase
          .from("payment_company_groups")
          .select("payment_id, company_name, bruto_total")
          .in("payment_id", paymentIds);

        const empresaByPayment: Record<string, string> = {};
        for (const g of groups ?? []) {
          const pid = (g as any).payment_id as string;
          const cur = empresaByPayment[pid];
          const valor = Number((g as any).bruto_total ?? 0);
          if (!cur || valor > 0) {
            // mantém a empresa com maior bruto
            empresaByPayment[pid] = (g as any).company_name || cur || "—";
          }
        }

        const mapped: Row[] = list.map((p: any) => {
          const bruto = Number(p.bruto_total ?? 0);
          const liquido = Number(p.liquido_total ?? 0);
          const ui = STATUS_MAP[p.status] ?? "em_analise";
          const cycleEnd = p.approved_at || p.validated_at || null;
          return {
            id: p.id,
            lote: shortenRef(p.reference) || `Lote ${String(p.id).slice(0, 8)}`,
            empresa: empresaByPayment[p.id] || "—",
            competencia: fmtCompetencia(p.competence_month),
            itens: Number(p.items_count ?? 0),
            valor: liquido || bruto,
            diferenca: liquido - bruto,
            ciclo: daysBetween(p.created_at, cycleEnd),
            status: ui,
            analista: analystByUser[p.created_by] || "—",
          };
        });
        setRows(mapped);
      } catch (e) {
        console.warn("[BiPagamentos] erro carregando dados:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return r.empresa.toLowerCase().includes(q) || r.lote.toLowerCase().includes(q) || r.analista.toLowerCase().includes(q);
      }
      return true;
    });
  }, [rows, query, statusFilter]);

  const totals = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.valor, 0);
    const pago = rows.filter((r) => r.status === "pago").reduce((s, r) => s + r.valor, 0);
    const aprovacao = rows.filter((r) => r.status === "em_aprovacao" || r.status === "em_analise").reduce((s, r) => s + r.valor, 0);
    const risco = rows.filter((r) => r.status === "risco").reduce((s, r) => s + r.valor, 0);
    const itensTotais = rows.reduce((s, r) => s + r.itens, 0);
    return { total, pago, aprovacao, risco, count: rows.length, itensTotais };
  }, [rows]);

  // mini-bars: top 7 lotes por valor (asc) pra dar sensação de "tendência"
  const sparkValues = useMemo(() => {
    const last = rows.slice(0, 7).map((r) => r.valor).reverse();
    return last.length ? last : [1, 1, 1, 1, 1, 1, 1];
  }, [rows]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-8 py-10 space-y-8">
        {/* breadcrumb + título */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Link to="/bi/diretoria" className="hover:text-foreground transition-colors">BI</Link>
              <ChevronRight className="h-3 w-3" />
              <span>Pagamentos</span>
            </div>
            <h1 className="text-[34px] font-semibold tracking-tight text-foreground leading-none">
              Pagamentos
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              {totals.count} lotes carregados · {totals.itensTotais.toLocaleString("pt-BR")} itens no total
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-9 px-3 rounded-full border border-border bg-card text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2">
              <Download className="h-4 w-4" />
              Exportar
            </button>
            <Link
              to="/pagamentos"
              className="h-9 px-4 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              Operacional
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* HERO + side */}
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-8 rounded-3xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 relative overflow-hidden">
            <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
            <div className="relative">
              <div className="text-xs font-medium uppercase tracking-wider text-primary-foreground/80">
                Volume processado · últimos {Math.min(rows.length, 40)} lotes
              </div>
              <div className="text-[56px] font-semibold tracking-tight leading-none mt-3" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtMi(totals.total)}
              </div>
              <div className="text-sm text-primary-foreground/80 mt-2">
                {totals.count} lotes · {totals.itensTotais.toLocaleString("pt-BR")} itens
              </div>

              <div className="grid grid-cols-3 gap-3 mt-8">
                <div className="rounded-2xl bg-white/10 backdrop-blur p-4">
                  <div className="text-[11px] uppercase tracking-wider text-primary-foreground/70">Pago</div>
                  <div className="text-xl font-semibold mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtMi(totals.pago)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/10 backdrop-blur p-4">
                  <div className="text-[11px] uppercase tracking-wider text-primary-foreground/70">Em aprovação</div>
                  <div className="text-xl font-semibold mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtMi(totals.aprovacao)}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/10 backdrop-blur p-4">
                  <div className="text-[11px] uppercase tracking-wider text-primary-foreground/70">Em risco</div>
                  <div className="text-xl font-semibold mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtMi(totals.risco)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-4 rounded-3xl bg-card border border-border p-6 flex flex-col">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Últimos lotes</div>
              <span className="text-xs text-muted-foreground">por valor</span>
            </div>
            <div className="mt-4">
              <MiniBars values={sparkValues} />
            </div>
            <div className="mt-auto pt-6 border-t border-border">
              <div className="text-xs text-muted-foreground">Maior lote</div>
              <div className="text-lg font-semibold text-foreground mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
                {rows.length ? fmtMi(Math.max(...rows.map((r) => r.valor))) : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {rows.length ? [...rows].sort((a, b) => b.valor - a.valor)[0].empresa : "Aguardando dados"}
              </div>
            </div>
          </div>
        </div>

        {/* Filtros + Lista */}
        <div className="rounded-3xl bg-card border border-border overflow-hidden">
          <div className="p-5 border-b border-border flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[280px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar lote, empresa ou analista…"
                className="w-full h-10 pl-10 pr-4 rounded-full bg-muted/50 border border-transparent focus:border-border focus:bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors"
              />
            </div>
            <div className="flex items-center gap-1 p-1 rounded-full bg-muted/50">
              {([
                ["all", "Todos"],
                ["pago", "Pagos"],
                ["aprovado", "Aprovados"],
                ["em_aprovacao", "Em aprovação"],
                ["risco", "Em risco"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setStatusFilter(k as any)}
                  className={`px-3 h-8 rounded-full text-xs font-medium transition-all ${
                    statusFilter === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button className="h-9 px-3 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Mais filtros
            </button>
          </div>

          <div className="px-6 py-3 grid grid-cols-12 gap-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border bg-muted/20">
            <div className="col-span-3">Lote · Empresa</div>
            <div className="col-span-1 text-right">Itens</div>
            <div className="col-span-2 text-right">Valor</div>
            <div className="col-span-2 text-right">Diferença</div>
            <div className="col-span-1 text-right">Ciclo</div>
            <div className="col-span-2">Analista</div>
            <div className="col-span-1 text-right">Status</div>
          </div>

          <div className="divide-y divide-border">
            {filtered.map((r) => {
              const meta = STATUS_META[r.status];
              const diffColor = r.diferenca > 0 ? "text-destructive" : r.diferenca < 0 ? "text-amber-600" : "text-muted-foreground";
              return (
                <Link
                  key={r.id}
                  to={`/bi/lote/${r.id}`}
                  className="px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-muted/30 transition-colors cursor-pointer group"
                >
                  <div className="col-span-3 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{r.empresa}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 truncate" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {r.lote} · {r.competencia}
                    </div>
                  </div>
                  <div className="col-span-1 text-right text-sm text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.itens}
                  </div>
                  <div className="col-span-2 text-right text-sm font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtFull(r.valor)}
                  </div>
                  <div className={`col-span-2 text-right text-sm font-medium ${diffColor}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.diferenca === 0 ? "—" : (r.diferenca > 0 ? "+" : "") + fmtFull(r.diferenca)}
                  </div>
                  <div className="col-span-1 text-right text-xs text-muted-foreground">{r.ciclo}</div>
                  <div className="col-span-2 flex items-center gap-2 min-w-0">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center text-[11px] font-semibold text-primary shrink-0">
                      {r.analista.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase() || "—"}
                    </div>
                    <span className="text-xs text-muted-foreground truncate">{r.analista}</span>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full border text-[11px] font-medium ${meta.tone}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>
                </Link>
              );
            })}
            {!loading && filtered.length === 0 && (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                {rows.length === 0 ? "Nenhum pagamento encontrado na base." : "Nenhum lote com esses filtros."}
              </div>
            )}
            {loading && (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">Carregando lotes…</div>
            )}
          </div>

          <div className="px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
            <span>Mostrando {filtered.length} de {rows.length} lotes</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> {rows.filter(r=>r.status==="pago").length} pagos</span>
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-amber-500" /> {rows.filter(r=>r.status==="em_aprovacao"||r.status==="em_analise").length} pendentes</span>
              <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-destructive" /> {rows.filter(r=>r.status==="risco").length} em risco</span>
            </div>
          </div>
        </div>

        {/* Atalhos */}
        <div className="grid grid-cols-3 gap-5">
          {[
            { icon: FileText, title: "Conferência de NF", desc: "Lançamento e conciliação", href: "/notas-fiscais" },
            { icon: AlertTriangle, title: "Pendências críticas", desc: "Acompanhar SLA aberto", href: "/pendencias" },
            { icon: CheckCircle2, title: "Aprovações da diretoria", desc: "Lotes para liberar", href: "/aprovacoes" },
          ].map((card) => (
            <Link
              key={card.title}
              to={card.href}
              className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4 hover:border-foreground/20 hover:shadow-sm transition-all group"
            >
              <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center shrink-0">
                <card.icon className="h-5 w-5 text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">{card.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{card.desc}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Link, useParams } from "react-router-dom";
import {
  ChevronRight,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Sparkles,
  Search,
  Download,
  ArrowUpRight,
  ShieldCheck,
  User,
  Building2,
  Stethoscope,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/status";

/**
 * BI · Detalhe do lote (Apple-style) — ligado aos dados reais.
 * Agrega payment_items por TUSS, calcula divergências e mostra trilha de auditoria
 * a partir de validated_at / approved_at do payment.
 */

const fmtFull = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtMi = (v: number) => {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return formatCurrency(v);
};

const MONTHS_PT_SHORT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
function fmtCompetencia(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${MONTHS_PT_SHORT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}
function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${MONTHS_PT_SHORT[d.getMonth()]} · ${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}`;
}
function daysBetween(a?: string | null, b?: string | null): string {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  return `${(ms / 86_400_000).toFixed(1).replace(".", ",")} d`;
}

type StepKey = "recebido" | "validacao" | "ia" | "diretoria" | "nf" | "pago";
type Step = { key: StepKey; label: string; sub: string; reached: boolean };

type TussRow = {
  tuss: string;
  desc: string;
  qtd: number;
  esperado: number;
  pago: number;
  status: "ok" | "divergente" | "alerta";
};

const STATUS_META: Record<TussRow["status"], { label: string; tone: string; dot: string }> = {
  ok: { label: "Conciliado", tone: "bg-success/10 text-success border-success/20", dot: "bg-success" },
  divergente: { label: "Divergente", tone: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
  alerta: { label: "Alerta", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20", dot: "bg-amber-500" },
};

const TOL = 0.01;
function tussStatus(esperado: number, pago: number): TussRow["status"] {
  const diff = pago - esperado;
  if (Math.abs(diff) <= TOL) return "ok";
  if (diff > 0) return "divergente";
  return "alerta";
}

const REACHED_BY_STATUS: Record<string, number> = {
  em_validacao: 1,
  aguardando_validacao: 1,
  em_analise_ia: 2,
  revisao_analista: 2,
  devolvido_analista: 2,
  aguardando_aprovacao: 3,
  aprovado: 4,
  nf_recebida: 4,
  pago: 5,
};

export default function BiLoteDetalhe() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [payment, setPayment] = useState<any | null>(null);
  const [analystName, setAnalystName] = useState<string>("—");
  const [empresaPrincipal, setEmpresaPrincipal] = useState<string>("—");
  const [empresasCount, setEmpresasCount] = useState<number>(0);
  const [tussRows, setTussRows] = useState<TussRow[]>([]);
  const [especialidadesTop, setEspecialidadesTop] = useState<string[]>([]);
  const [especialidadesCount, setEspecialidadesCount] = useState<number>(0);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"todos" | "divergente" | "alerta">("todos");

  useEffect(() => {
    document.title = "BI · Detalhe do lote | Exacta";
    if (!id) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    (async () => {
      try {
        // 1) lote
        const { data: pay } = await supabase
          .from("payments")
          .select("id, reference, status, competence_month, bruto_total, liquido_total, items_count, created_at, validated_at, approved_at, created_by, ai_summary")
          .eq("id", id)
          .maybeSingle();
        if (!pay) {
          setNotFound(true);
          return;
        }
        setPayment(pay);

        // 2) analista
        if ((pay as any).created_by) {
          const { data: pr } = await supabase
            .from("profiles")
            .select("full_name, email")
            .eq("id", (pay as any).created_by)
            .maybeSingle();
          if (pr) setAnalystName((pr as any).full_name || (pr as any).email || "—");
        }

        // 3) empresas do lote
        const { data: groups } = await supabase
          .from("payment_company_groups")
          .select("company_name, bruto_total")
          .eq("payment_id", id);
        if (groups && groups.length) {
          setEmpresasCount(groups.length);
          const top = [...groups].sort((a: any, b: any) => Number(b.bruto_total ?? 0) - Number(a.bruto_total ?? 0))[0];
          setEmpresaPrincipal((top as any)?.company_name || "—");
        }

        // 4) items → TUSS aggregation + especialidades
        const { data: items } = await supabase
          .from("payment_items")
          .select("procedure_code, procedure_name, quantity, expected_amount, gross_amount, specialty, is_cancelled")
          .eq("payment_id", id)
          .eq("is_cancelled", false);

        const tussMap = new Map<string, TussRow>();
        const espMap = new Map<string, number>();
        for (const it of items ?? []) {
          const code = (it as any).procedure_code || "—";
          const nome = (it as any).procedure_name || "—";
          const qtd = Number((it as any).quantity ?? 0);
          const esperado = Number((it as any).expected_amount ?? 0);
          const pago = Number((it as any).gross_amount ?? 0);
          const cur = tussMap.get(code);
          if (cur) {
            cur.qtd += qtd;
            cur.esperado += esperado;
            cur.pago += pago;
          } else {
            tussMap.set(code, { tuss: code, desc: nome, qtd, esperado, pago, status: "ok" });
          }
          const esp = ((it as any).specialty || "").trim();
          if (esp) espMap.set(esp, (espMap.get(esp) ?? 0) + 1);
        }
        const tussList = Array.from(tussMap.values())
          .map((r) => ({ ...r, status: tussStatus(r.esperado, r.pago) }))
          .sort((a, b) => b.pago - a.pago);
        setTussRows(tussList);

        const espSorted = Array.from(espMap.entries()).sort((a, b) => b[1] - a[1]);
        setEspecialidadesCount(espSorted.length);
        setEspecialidadesTop(espSorted.slice(0, 3).map(([k]) => k));
      } catch (e) {
        console.warn("[BiLoteDetalhe] erro carregando:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const tussFiltered = useMemo(() => {
    return tussRows.filter((r) => {
      if (tab !== "todos" && r.status !== tab) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return r.tuss.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tussRows, query, tab]);

  const totals = useMemo(() => {
    const esperado = tussRows.reduce((s, r) => s + r.esperado, 0);
    const pago = tussRows.reduce((s, r) => s + r.pago, 0);
    const divergentes = tussRows.filter((r) => r.status !== "ok").length;
    const conf = tussRows.length ? Math.round(((tussRows.length - divergentes) / tussRows.length) * 100) : 100;
    return { esperado, pago, divergentes, conf, anomalies: divergentes };
  }, [tussRows]);

  const steps: Step[] = useMemo(() => {
    const reached = REACHED_BY_STATUS[payment?.status] ?? 0;
    return [
      { key: "recebido", label: "Recebido", sub: fmtDateTime(payment?.created_at), reached: reached >= 0 },
      { key: "validacao", label: "Validação", sub: fmtDateTime(payment?.validated_at), reached: reached >= 1 },
      { key: "ia", label: "Em análise", sub: payment?.ai_summary ? "Concluída" : "—", reached: reached >= 2 },
      { key: "diretoria", label: "Aprovação dir.", sub: fmtDateTime(payment?.approved_at), reached: reached >= 3 },
      { key: "nf", label: "Pós-aprov. NF", sub: payment?.status === "nf_recebida" || payment?.status === "pago" ? "OK" : "—", reached: reached >= 4 },
      { key: "pago", label: "Pago", sub: payment?.status === "pago" ? "OK" : "—", reached: reached >= 5 },
    ];
  }, [payment]);

  const currentStepIdx = Math.max(0, steps.filter((s) => s.reached).length - 1);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando lote…</div>
      </div>
    );
  }
  if (notFound || !payment) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <div className="text-sm text-muted-foreground">Lote não encontrado.</div>
        <Link to="/bi/pagamentos" className="text-sm text-primary hover:underline">← Voltar para a lista</Link>
      </div>
    );
  }

  const empresaTitle = empresaPrincipal || "—";
  const reference = payment.reference || `Lote ${String(payment.id).slice(0, 8)}`;
  const competencia = fmtCompetencia(payment.competence_month);
  const valor = Number(payment.liquido_total ?? payment.bruto_total ?? 0);
  const diff = Number(payment.liquido_total ?? 0) - Number(payment.bruto_total ?? 0);
  const itens = Number(payment.items_count ?? 0);
  const ciclo = daysBetween(payment.created_at, payment.approved_at || payment.validated_at);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-8 py-10 space-y-8">
        <div className="-mx-8 -mt-10">
          <PageHeader
            title={empresaTitle}
            description={`${reference} · Competência ${competencia} · ${itens} itens`}
            breadcrumb={[
              { label: "BI", to: "/bi/diretoria" },
              { label: "Pagamentos", to: "/bi/pagamentos" },
              { label: "Detalhe" },
            ]}
            actions={
              <>
                <button className="h-9 px-3 rounded-full border border-border bg-card text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  Exportar
                </button>
                <Link
                  to={`/pagamentos/${payment.id}`}
                  className="h-9 px-4 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
                >
                  Abrir operacional
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </>
            }
          />
        </div>

        {/* HERO valor + stepper */}
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-8 rounded-3xl bg-gradient-to-br from-primary to-primary/80 text-primary-foreground p-8 relative overflow-hidden">
            <div className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
            <div className="relative">
              <div className="text-xs font-medium uppercase tracking-wider text-primary-foreground/80">
                Valor do lote
              </div>
              <div className="text-[56px] font-semibold tracking-tight leading-none mt-3" style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtMi(valor)}
              </div>
              <div className="text-sm text-primary-foreground/80 mt-2">
                Diferença total {diff >= 0 ? "+" : ""}{fmtFull(diff)} · {itens} itens · ciclo {ciclo}
              </div>

              {/* Stepper */}
              <div className="mt-8">
                <div className="relative">
                  <div className="absolute left-0 right-0 top-3 h-px bg-white/20" />
                  <div className="absolute left-0 top-3 h-px bg-white" style={{ width: `${(currentStepIdx / (steps.length - 1)) * 100}%` }} />
                  <div className="relative grid" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
                    {steps.map((s, i) => {
                      const done = i < currentStepIdx;
                      const current = i === currentStepIdx;
                      return (
                        <div key={s.key} className="flex flex-col items-center">
                          <div
                            className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                              done
                                ? "bg-white text-primary"
                                : current
                                ? "bg-white text-primary ring-4 ring-white/30"
                                : "bg-white/15 text-white/70"
                            }`}
                          >
                            {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                          </div>
                          <div className="mt-2 text-[11px] font-medium text-primary-foreground/95">{s.label}</div>
                          <div className="text-[10px] text-primary-foreground/60" style={{ fontVariantNumeric: "tabular-nums" }}>
                            {s.sub}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Card IA */}
          <div className="col-span-4 rounded-3xl bg-card border border-border p-6 flex flex-col">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Resumo da IA</div>
            </div>
            <p className="text-sm text-foreground leading-relaxed mt-4">
              {payment.ai_summary ? (
                <span className="line-clamp-5">{payment.ai_summary}</span>
              ) : totals.divergentes > 0 ? (
                <>
                  Lote com <span className="font-semibold">{totals.divergentes} TUSS</span> divergente
                  {totals.divergentes > 1 ? "s" : ""}. Auditoria recomendada antes da liberação.
                </>
              ) : (
                <>Lote conciliado integralmente. Nenhuma divergência detectada.</>
              )}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confiança</div>
                <div className="text-lg font-semibold text-foreground mt-1">{totals.conf}%</div>
              </div>
              <div className="rounded-2xl border border-border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Anomalias</div>
                <div className="text-lg font-semibold text-foreground mt-1">{totals.anomalies}</div>
              </div>
            </div>
            <Link
              to={`/pagamentos/${payment.id}`}
              className="mt-5 h-9 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <ShieldCheck className="h-4 w-4" />
              Abrir no operacional
            </Link>
          </div>
        </div>

        {/* Metadados rápidos */}
        <div className="grid grid-cols-4 gap-5">
          {[
            { icon: Building2, label: "Empresas", value: empresasCount ? `${empresasCount} empresa${empresasCount > 1 ? "s" : ""}` : "—", sub: empresaPrincipal },
            { icon: User, label: "Analista", value: analystName, sub: `Criado ${fmtDateTime(payment.created_at)}` },
            {
              icon: Stethoscope,
              label: "Especialidades",
              value: especialidadesCount ? `${especialidadesCount} grupos` : "—",
              sub: especialidadesTop.join(" · ") || "—",
            },
            { icon: FileText, label: "Status", value: payment.status?.replace(/_/g, " ") || "—", sub: `Itens ${itens}` },
          ].map((c) => (
            <div key={c.label} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <c.icon className="h-3.5 w-3.5" />
                {c.label}
              </div>
              <div className="text-sm font-semibold text-foreground mt-2 truncate">{c.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5 truncate">{c.sub}</div>
            </div>
          ))}
        </div>

        {/* Auditoria TUSS */}
        <div className="rounded-3xl bg-card border border-border overflow-hidden">
          <div className="p-5 border-b border-border flex items-center gap-3 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-foreground">Auditoria TUSS</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {fmtFull(totals.esperado)} esperado · {fmtFull(totals.pago)} pago · {totals.divergentes} divergência{totals.divergentes !== 1 ? "s" : ""}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar TUSS ou descrição…"
                  className="w-72 h-9 pl-9 pr-3 rounded-full bg-muted/50 border border-transparent focus:border-border focus:bg-card text-sm text-foreground placeholder:text-muted-foreground outline-none transition-colors"
                />
              </div>
              <div className="flex items-center gap-1 p-1 rounded-full bg-muted/50">
                {([
                  ["todos", "Todos"],
                  ["divergente", "Divergentes"],
                  ["alerta", "Alertas"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setTab(k as any)}
                    className={`px-3 h-7 rounded-full text-xs font-medium transition-all ${
                      tab === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-6 py-3 grid grid-cols-12 gap-4 text-[11px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border bg-muted/20">
            <div className="col-span-2">TUSS</div>
            <div className="col-span-4">Procedimento</div>
            <div className="col-span-1 text-right">Qtd</div>
            <div className="col-span-2 text-right">Esperado</div>
            <div className="col-span-2 text-right">Pago</div>
            <div className="col-span-1 text-right">Status</div>
          </div>

          <div className="divide-y divide-border">
            {tussFiltered.map((r) => {
              const meta = STATUS_META[r.status];
              const delta = r.pago - r.esperado;
              const deltaColor = delta > 0 ? "text-destructive" : delta < 0 ? "text-amber-600" : "text-muted-foreground";
              return (
                <div key={r.tuss} className="px-6 py-4 grid grid-cols-12 gap-4 items-center hover:bg-muted/30 transition-colors">
                  <div className="col-span-2 text-sm font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.tuss}
                  </div>
                  <div className="col-span-4 text-sm text-foreground truncate" title={r.desc}>{r.desc}</div>
                  <div className="col-span-1 text-right text-sm text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.qtd}
                  </div>
                  <div className="col-span-2 text-right text-sm text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtFull(r.esperado)}
                  </div>
                  <div className="col-span-2 text-right">
                    <div className="text-sm font-semibold text-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {fmtFull(r.pago)}
                    </div>
                    {Math.abs(delta) > TOL && (
                      <div className={`text-[11px] ${deltaColor}`} style={{ fontVariantNumeric: "tabular-nums" }}>
                        {delta > 0 ? "+" : ""}{fmtFull(delta)}
                      </div>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 h-6 rounded-full border text-[11px] font-medium ${meta.tone}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                  </div>
                </div>
              );
            })}
            {tussFiltered.length === 0 && (
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">Nenhum TUSS encontrado.</div>
            )}
          </div>

          <div className="px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
            <span>Mostrando {tussFiltered.length} de {tussRows.length} TUSS</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> {tussRows.filter(r=>r.status==="ok").length} conciliados</span>
              <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-destructive" /> {tussRows.filter(r=>r.status==="divergente").length} divergentes</span>
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-amber-500" /> {tussRows.filter(r=>r.status==="alerta").length} alertas</span>
            </div>
          </div>
        </div>

        {/* Trilha de auditoria + ações */}
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-8 rounded-3xl bg-card border border-border p-6">
            <div className="text-sm font-semibold text-foreground">Trilha de auditoria</div>
            <div className="text-xs text-muted-foreground mt-0.5">Eventos registrados no lote</div>

            <div className="mt-6 relative pl-6">
              <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
              {([
                payment.approved_at && {
                  who: analystName !== "—" ? analystName : "Diretoria",
                  what: `Aprovou o lote (${payment.status})`,
                  when: fmtDateTime(payment.approved_at),
                  tone: "primary" as const,
                },
                payment.validated_at && {
                  who: analystName !== "—" ? analystName : "Analista",
                  what: "Validou o lote",
                  when: fmtDateTime(payment.validated_at),
                  tone: "success" as const,
                },
                payment.ai_summary && {
                  who: "IA Exacta",
                  what: totals.divergentes > 0
                    ? `Identificou ${totals.divergentes} divergência${totals.divergentes>1?"s":""} em TUSS`
                    : "Concluiu análise sem divergências",
                  when: fmtDateTime(payment.validated_at || payment.created_at),
                  tone: totals.divergentes > 0 ? ("amber" as const) : ("success" as const),
                },
                {
                  who: "Sistema",
                  what: `Lote recebido (${payment.items_count ?? 0} itens)`,
                  when: fmtDateTime(payment.created_at),
                  tone: "muted" as const,
                },
              ].filter(Boolean) as { who: string; what: string; when: string; tone: "primary" | "amber" | "success" | "muted" }[])
                .map((e, i) => (
                  <div key={i} className="relative pb-5 last:pb-0">
                    <div
                      className={`absolute -left-[18px] top-1 h-3 w-3 rounded-full ring-4 ring-card ${
                        e.tone === "primary" ? "bg-primary"
                        : e.tone === "amber" ? "bg-amber-500"
                        : e.tone === "success" ? "bg-success"
                        : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="text-sm text-foreground">
                      <span className="font-semibold">{e.who}</span> · {e.what}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>{e.when}</div>
                  </div>
                ))}
            </div>
          </div>

          <div className="col-span-4 rounded-3xl bg-card border border-border p-6 flex flex-col gap-3">
            <div className="text-sm font-semibold text-foreground">Ações sugeridas</div>
            <Link
              to={`/pagamentos/${payment.id}`}
              className="h-11 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-between px-4"
            >
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Abrir lote no operacional</span>
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              to="/pendencias"
              className="h-11 rounded-2xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between px-4"
            >
              <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Ver pendências</span>
              <ChevronRight className="h-4 w-4" />
            </Link>
            <Link
              to="/notas-fiscais"
              className="h-11 rounded-2xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between px-4"
            >
              <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Conciliar NF</span>
              <ChevronRight className="h-4 w-4" />
            </Link>
            <div className="mt-auto pt-5 border-t border-border text-xs text-muted-foreground">
              Última atualização <span className="text-foreground font-medium">{fmtDateTime(payment.approved_at || payment.validated_at || payment.created_at)}</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

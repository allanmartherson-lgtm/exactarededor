import { useEffect, useMemo, useState } from "react";
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
 * BI · Detalhe do lote (Apple-style)
 *
 * Página puramente visual: stepper, auditoria TUSS, resumo IA.
 * Lê dados reais de payments quando :id existe; fallback estático.
 * Não substitui PaymentDetail.tsx (operacional).
 */

const fmtFull = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtMi = (v: number) => {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}k`;
  return formatCurrency(v);
};

type StepKey = "recebido" | "validacao" | "ia" | "diretoria" | "nf" | "pago";
const STEPS: { key: StepKey; label: string; sub: string }[] = [
  { key: "recebido", label: "Recebido", sub: "16/Mai · 09h" },
  { key: "validacao", label: "Validação", sub: "16/Mai · 10h" },
  { key: "ia", label: "Análise IA", sub: "16/Mai · 10h" },
  { key: "diretoria", label: "Aprovação dir.", sub: "17/Mai · 14h" },
  { key: "nf", label: "Pós-aprov. NF", sub: "20/Mai · 09h" },
  { key: "pago", label: "Pago", sub: "—" },
];

type TussRow = {
  tuss: string;
  desc: string;
  qtd: number;
  esperado: number;
  pago: number;
  status: "ok" | "divergente" | "alerta";
};

const FALLBACK_TUSS: TussRow[] = [
  { tuss: "30602050", desc: "Colecistectomia videolaparoscópica", qtd: 18, esperado: 142_300, pago: 142_300, status: "ok" },
  { tuss: "30912019", desc: "Herniorrafia inguinal unilateral", qtd: 12, esperado: 86_400, pago: 89_120, status: "divergente" },
  { tuss: "40601218", desc: "USG abdome total", qtd: 42, esperado: 38_220, pago: 38_220, status: "ok" },
  { tuss: "30606016", desc: "Apendicectomia", qtd: 7, esperado: 54_600, pago: 54_600, status: "ok" },
  { tuss: "31309044", desc: "Cesariana", qtd: 9, esperado: 122_400, pago: 118_900, status: "alerta" },
  { tuss: "40808010", desc: "Tomografia crânio s/ contraste", qtd: 23, esperado: 41_400, pago: 41_400, status: "ok" },
  { tuss: "30730020", desc: "Histerectomia total", qtd: 4, esperado: 68_200, pago: 71_440, status: "divergente" },
];

const STATUS_META: Record<TussRow["status"], { label: string; tone: string; dot: string }> = {
  ok: { label: "Conciliado", tone: "bg-success/10 text-success border-success/20", dot: "bg-success" },
  divergente: { label: "Divergente", tone: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
  alerta: { label: "Alerta", tone: "bg-amber-500/10 text-amber-600 border-amber-500/20", dot: "bg-amber-500" },
};

export default function BiLoteDetalhe() {
  const { id } = useParams();
  const [empresa, setEmpresa] = useState("Med Center Brasília");
  const [lote, setLote] = useState("L-2604-018");
  const [competencia, setCompetencia] = useState("Mai/26");
  const [valor, setValor] = useState(1_842_300);
  const [diff, setDiff] = useState(2_460);
  const [itens] = useState(248);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"todos" | "divergente" | "alerta">("todos");

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data } = await supabase
          .from("payments")
          .select("batch_code, company_name, competence_month, total_amount, total_difference")
          .eq("id", id)
          .maybeSingle();
        if (data) {
          setEmpresa((data as any).company_name || empresa);
          setLote((data as any).batch_code || lote);
          setCompetencia((data as any).competence_month || competencia);
          setValor(Number((data as any).total_amount) || valor);
          setDiff(Number((data as any).total_difference) || diff);
        }
      } catch { /* silent */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const tussFiltered = useMemo(() => {
    return FALLBACK_TUSS.filter((r) => {
      if (tab !== "todos" && r.status !== tab) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return r.tuss.includes(q) || r.desc.toLowerCase().includes(q);
      }
      return true;
    });
  }, [query, tab]);

  const totals = useMemo(() => {
    const esperado = FALLBACK_TUSS.reduce((s, r) => s + r.esperado, 0);
    const pago = FALLBACK_TUSS.reduce((s, r) => s + r.pago, 0);
    const divergentes = FALLBACK_TUSS.filter((r) => r.status !== "ok").length;
    return { esperado, pago, divergentes };
  }, []);

  // stepper progress: até "nf" concluído, "pago" pendente
  const currentStepIdx = 4;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1440px] mx-auto px-8 py-10 space-y-8">
        {/* Breadcrumb + header */}
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Link to="/bi/diretoria" className="hover:text-foreground transition-colors">BI</Link>
              <ChevronRight className="h-3 w-3" />
              <Link to="/bi/pagamentos" className="hover:text-foreground transition-colors">Pagamentos</Link>
              <ChevronRight className="h-3 w-3" />
              <span>Detalhe</span>
            </div>
            <h1 className="text-[34px] font-semibold tracking-tight text-foreground leading-none">{empresa}</h1>
            <div className="flex items-center gap-3 mt-3 text-sm text-muted-foreground">
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{lote}</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <span>Competência {competencia}</span>
              <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
              <span>{itens} itens</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-9 px-3 rounded-full border border-border bg-card text-sm text-foreground hover:bg-muted transition-colors flex items-center gap-2">
              <Download className="h-4 w-4" />
              Exportar
            </button>
            <Link
              to={id ? `/pagamentos/${id}` : "/pagamentos"}
              className="h-9 px-4 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              Abrir operacional
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
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
                Diferença total {diff >= 0 ? "+" : ""}{fmtFull(diff)} · {itens} itens · ciclo 1,6 d
              </div>

              {/* Stepper */}
              <div className="mt-8">
                <div className="relative">
                  <div className="absolute left-0 right-0 top-3 h-px bg-white/20" />
                  <div className="absolute left-0 top-3 h-px bg-white" style={{ width: `${(currentStepIdx / (STEPS.length - 1)) * 100}%` }} />
                  <div className="relative grid" style={{ gridTemplateColumns: `repeat(${STEPS.length}, 1fr)` }}>
                    {STEPS.map((s, i) => {
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

          {/* Card IA — resumo */}
          <div className="col-span-4 rounded-3xl bg-card border border-border p-6 flex flex-col">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Resumo da IA</div>
            </div>
            <p className="text-sm text-foreground leading-relaxed mt-4">
              Lote dentro do padrão. <span className="font-semibold">{totals.divergentes} TUSS</span> com
              divergência marginal (<span className="text-amber-600 font-medium">0,1%</span> do volume).
              Recomendado aprovação com observação para auditoria pontual em <span className="font-semibold">cesariana</span> e <span className="font-semibold">histerectomia</span>.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Confiança</div>
                <div className="text-lg font-semibold text-foreground mt-1">94%</div>
              </div>
              <div className="rounded-2xl border border-border p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Anomalias</div>
                <div className="text-lg font-semibold text-foreground mt-1">2</div>
              </div>
            </div>
            <button className="mt-5 h-9 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Aprovar com observação
            </button>
          </div>
        </div>

        {/* Metadados rápidos */}
        <div className="grid grid-cols-4 gap-5">
          {[
            { icon: Building2, label: "Empresa", value: empresa, sub: "CNPJ 12.345.678/0001-90" },
            { icon: User, label: "Analista", value: "Allan Araújo", sub: "Encerrou em 1,6 d" },
            { icon: Stethoscope, label: "Especialidades", value: "8 grupos", sub: "Cirurgia · Imagem · GO" },
            { icon: FileText, label: "Documentos", value: "3 anexos", sub: "NF · Boleto · Recibo" },
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
                {fmtFull(totals.esperado)} esperado · {fmtFull(totals.pago)} pago · {totals.divergentes} divergências
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
                  <div className="col-span-4 text-sm text-foreground truncate">{r.desc}</div>
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
                    {delta !== 0 && (
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
            <span>Mostrando {tussFiltered.length} de {FALLBACK_TUSS.length} TUSS</span>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-success" /> {FALLBACK_TUSS.filter(r=>r.status==="ok").length} conciliados</span>
              <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 text-destructive" /> {FALLBACK_TUSS.filter(r=>r.status==="divergente").length} divergentes</span>
              <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-amber-500" /> {FALLBACK_TUSS.filter(r=>r.status==="alerta").length} alertas</span>
            </div>
          </div>
        </div>

        {/* Auditoria timeline */}
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-8 rounded-3xl bg-card border border-border p-6">
            <div className="text-sm font-semibold text-foreground">Trilha de auditoria</div>
            <div className="text-xs text-muted-foreground mt-0.5">7 eventos registrados</div>

            <div className="mt-6 relative pl-6">
              <div className="absolute left-2 top-1 bottom-1 w-px bg-border" />
              {[
                { who: "Allan Araújo", what: "Encaminhou para diretoria", when: "17/Mai · 09h21", tone: "primary" },
                { who: "IA Exacta", what: "Identificou 2 divergências marginais em cesariana e histerectomia", when: "16/Mai · 10h48", tone: "amber" },
                { who: "IA Exacta", what: "Validou 245 itens automaticamente (98,8%)", when: "16/Mai · 10h47", tone: "success" },
                { who: "Sistema", what: "Lote recebido via integração Tasy", when: "16/Mai · 09h12", tone: "muted" },
              ].map((e, i) => (
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
            <button className="h-11 rounded-2xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity flex items-center justify-between px-4">
              <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Aprovar lote</span>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className="h-11 rounded-2xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between px-4">
              <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Solicitar revisão</span>
              <ChevronRight className="h-4 w-4" />
            </button>
            <button className="h-11 rounded-2xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center justify-between px-4">
              <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Anexar nota fiscal</span>
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="mt-auto pt-5 border-t border-border text-xs text-muted-foreground">
              Última sincronização há <span className="text-foreground font-medium">3 min</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

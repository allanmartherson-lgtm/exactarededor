import { useState } from "react";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Calendar, CheckCircle2, ChevronRight,
  Clock, FileText, Filter, LayoutGrid, MapPin, MoreHorizontal, Play, Plus, Search,
  Settings, Sliders, Sparkles, TrendingUp, Users,
} from "lucide-react";

/**
 * Mockup — Exacta renderizado com o Design System CURA (Rede D'Or).
 * Acesse em /preview-cura
 *
 * Tokens hard-coded a partir do projeto "APP Médico Rede D'Or MVP - Entrega 01 - DS"
 * (src/styles.css). NÃO usa o tema atual do Exacta — tela isolada para comparação.
 *
 * Telas incluídas (abas no topo do mockup):
 *  - Dashboard (visão executiva)
 *  - Lote (detalhe de pagamento)
 *  - Regras (biblioteca de regras)
 *  - Conciliação (comparação hospital × Exacta)
 */

const C = {
  primary: "#003DA5",
  primaryDark: "#003075",
  primaryDarker: "#002855",
  primaryLight: "#71C5E8",
  primarySoft: "#CFE2FF",
  accent: "#FF8200",
  accentSoft: "#FFC27B",
  accentLighter: "#FFECD1",
  n0: "#FFFFFF",
  n100: "#F6F6F6",
  n200: "#E9E9E9",
  n300: "#E2E2E2",
  n400: "#D4D4D4",
  n500: "#B7B7B7",
  n700: "#6E6E6E",
  n800: "#4A4A4A",
  n900: "#262626",
  success: "#5FD290",
  successSoft: "#DFF6E9",
  successDark: "#31734D",
  warning: "#F5EF4E",
  warningSoft: "#FCFAC4",
  warningDark: "#6C6A20",
  error: "#CE2A2A",
  errorSoft: "#FBDDDD",
  info: "#6EA8FF",
  infoSoft: "#CFE2FF",
  infoDark: "#253855",
};

const font = "'Gotham', Arial, Helvetica, sans-serif";
const CARD_BORDER = `2px solid ${C.n200}`;
const SHADOW = "0 2px 5px 0 rgba(38,38,38,0.16)";

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function Chip({
  children, bg, color, Icon,
}: { children: React.ReactNode; bg: string; color: string; Icon?: typeof Clock }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-[4px] whitespace-nowrap"
      style={{ background: bg, color, letterSpacing: "0.02em" }}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function SectionLabel({ children, extra }: { children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <p className="text-[11px] font-medium uppercase" style={{ color: C.n700, letterSpacing: "0.08em" }}>
        {children}
      </p>
      {extra}
    </div>
  );
}

function Card({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={className}
      style={{ background: C.n0, border: CARD_BORDER, borderRadius: 8, boxShadow: SHADOW, ...style }}
    >
      {children}
    </div>
  );
}

function Button({
  children, variant = "primary", Icon, size = "md",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "accent";
  Icon?: typeof Clock;
  size?: "sm" | "md";
}) {
  const h = size === "sm" ? "h-8 px-3 text-[12px]" : "h-9 px-4 text-[13px]";
  const style: React.CSSProperties =
    variant === "primary" ? { background: C.primary, color: C.n0 }
    : variant === "accent" ? { background: C.accent, color: C.n0 }
    : variant === "secondary" ? { background: C.n0, color: C.n800, border: `2px solid ${C.n400}` }
    : { background: "transparent", color: C.primary };
  return (
    <button className={`${h} inline-flex items-center gap-2 font-medium rounded-[4px]`} style={style}>
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// shell — sidebar + header
// ---------------------------------------------------------------------------

type NavKey = "dashboard" | "lote" | "regras" | "conciliacao";

function Sidebar({ active, onChange }: { active: NavKey; onChange: (k: NavKey) => void }) {
  const items: { key: NavKey | "other"; label: string; Icon: typeof Clock; badge?: number }[] = [
    { key: "dashboard", label: "Dashboard", Icon: LayoutGrid },
    { key: "lote", label: "Pagamentos", Icon: FileText, badge: 12 },
    { key: "other", label: "Pendências", Icon: AlertTriangle, badge: 4 },
    { key: "conciliacao", label: "Conciliação", Icon: CheckCircle2 },
    { key: "regras", label: "Regras", Icon: Sliders },
    { key: "other", label: "Cadastros", Icon: Users },
    { key: "other", label: "Relatórios", Icon: TrendingUp },
    { key: "other", label: "Configurações", Icon: Settings },
  ];
  return (
    <aside className="w-[232px] shrink-0 flex flex-col" style={{ background: C.n0, borderRight: `2px solid ${C.n200}` }}>
      <div className="px-5 h-16 flex items-center gap-2" style={{ borderBottom: `2px solid ${C.n200}` }}>
        <div className="h-9 w-9 rounded-full grid place-items-center" style={{ background: C.primary }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12l4 4 10-10" stroke={C.accentSoft} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-medium" style={{ color: C.n900, fontFamily: font }}>
            E<span style={{ color: C.accent }}>x</span>acta
          </div>
          <div className="text-[9px] font-medium tracking-[0.18em]" style={{ color: C.n700 }}>REDE D'OR</div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((it, i) => {
          const isActive = it.key === active;
          const clickable = it.key !== "other";
          return (
            <button
              key={i}
              onClick={() => clickable && onChange(it.key as NavKey)}
              className="w-full flex items-center gap-3 px-3 h-9 rounded-[4px] text-[13px] transition-colors"
              style={{
                background: isActive ? C.infoSoft : "transparent",
                color: isActive ? C.primaryDark : C.n800,
                fontWeight: isActive ? 500 : 400,
                borderLeft: isActive ? `3px solid ${C.primary}` : "3px solid transparent",
                cursor: clickable ? "pointer" : "default",
                opacity: clickable ? 1 : 0.85,
              }}
            >
              <it.Icon className="h-4 w-4" strokeWidth={2} />
              <span className="flex-1 text-left">{it.label}</span>
              {it.badge != null && (
                <span
                  className="text-[10px] font-semibold px-1.5 h-4 rounded-full grid place-items-center"
                  style={{ background: isActive ? C.primary : C.n400, color: isActive ? C.n0 : C.n800, minWidth: 16 }}
                >
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="px-4 py-3 text-[11px]" style={{ color: C.n700, borderTop: `2px solid ${C.n200}` }}>
        Hospital DF Star · Abril/2026
      </div>
    </aside>
  );
}

function TopBar({ crumb }: { crumb: string[] }) {
  return (
    <header
      className="h-16 px-6 flex items-center justify-between shrink-0"
      style={{ background: C.primary, color: C.n0, ["--cura-font-color" as string]: C.n0 } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 min-w-0">
        {crumb.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <ChevronRight className="h-3 w-3 opacity-60" />}
            <span
              className={i === crumb.length - 1 ? "text-[14px] font-medium truncate" : "text-[11px] uppercase tracking-[0.12em] opacity-80"}
            >
              {c}
            </span>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 h-9 px-3 rounded-[4px]" style={{ background: C.n0, color: C.n800, width: 300 }}>
          <Search className="h-4 w-4" style={{ color: C.n500 }} />
          <input
            placeholder="Buscar..."
            className="flex-1 bg-transparent outline-none text-[13px]"
            style={{ color: C.n800 }}
          />
        </div>
        <button className="h-9 w-9 rounded-[4px] grid place-items-center relative" style={{ background: "rgba(255,255,255,0.10)" }} aria-label="Notificações">
          <Bell className="h-4 w-4" />
          <span
            className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold grid place-items-center"
            style={{ background: C.error, color: C.n0 }}
          >3</span>
        </button>
        <div className="h-9 w-9 rounded-full grid place-items-center text-[12px] font-semibold" style={{ background: C.primaryLight, color: C.n900 }}>
          AM
        </div>
      </div>
    </header>
  );
}

/** Faixa institucional. Gradiente permanece escuro dos dois lados para
 *  manter contraste WCAG AA com texto branco em qualquer largura. */
function BrandBanner({
  eyebrow, title, meta, actions,
}: { eyebrow: string; title: string; meta?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div
      className="px-8 py-5 flex items-center justify-between gap-6"
      style={{
        background: `linear-gradient(135deg, ${C.primaryDarker} 0%, ${C.primaryDark} 55%, ${C.primary} 100%)`,
        color: C.n0,
        borderBottom: `1px solid ${C.primaryDarker}`,
      }}
    >
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.12em]" style={{ color: C.primaryLight }}>{eyebrow}</p>
        <h1 className="text-[22px] font-medium mt-1 leading-tight truncate" style={{ letterSpacing: "-0.01em", color: C.n0 }}>
          {title}
        </h1>
        {meta && <div className="flex items-center gap-4 mt-2 text-[12px]" style={{ color: "rgba(255,255,255,0.85)" }}>{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

function Kpi({
  label, value, sub, tone = "default", trend,
}: {
  label: string; value: string; sub?: React.ReactNode;
  tone?: "default" | "danger" | "warning" | "success" | "primary";
  trend?: { dir: "up" | "down"; text: string; positive?: boolean };
}) {
  const toneColor =
    tone === "danger" ? C.error :
    tone === "warning" ? C.warningDark :
    tone === "success" ? C.successDark :
    tone === "primary" ? C.primary :
    C.n900;
  return (
    <Card className="p-4">
      <p className="text-[11px] font-medium uppercase" style={{ color: C.n700, letterSpacing: "0.08em" }}>{label}</p>
      <div className="flex items-baseline justify-between mt-1">
        <p className="text-[22px] font-medium tabular-nums leading-tight" style={{ color: toneColor }}>{value}</p>
        {trend && (
          <span
            className="inline-flex items-center gap-0.5 text-[11px] font-medium"
            style={{ color: trend.positive ? C.successDark : C.error }}
          >
            {trend.dir === "up" ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {trend.text}
          </span>
        )}
      </div>
      {sub && <div className="mt-2 text-[11.5px]" style={{ color: C.n700 }}>{sub}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Screen 1 — Dashboard
// ---------------------------------------------------------------------------

function ScreenDashboard() {
  return (
    <>
      <BrandBanner
        eyebrow="Visão executiva"
        title="Painel de pagamentos médicos"
        meta={
          <>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Competência 04/2026</span>
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> DF Star + 4 hospitais</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> 3 analistas ativos</span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" Icon={Filter}>Filtrar período</Button>
            <Button variant="accent" Icon={Plus}>Novo lote</Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        <section>
          <SectionLabel>Indicadores do mês</SectionLabel>
          <div className="grid grid-cols-4 gap-4">
            <Kpi label="Total pago no mês" value="R$ 4.812.330" tone="primary" trend={{ dir: "up", text: "+8,2% vs mar", positive: true }} sub="47 lotes aprovados" />
            <Kpi label="Economia por regra" value="R$ 187.420" tone="success" trend={{ dir: "up", text: "+12%", positive: true }} sub={<Chip bg={C.successSoft} color={C.successDark}>reduziu 3,9%</Chip>} />
            <Kpi label="Divergências abertas" value="24" tone="danger" trend={{ dir: "down", text: "−6 vs mar", positive: true }} sub="R$ 42.180 em disputa" />
            <Kpi label="SLA médio de análise" value="2,4 dias" tone="warning" sub={<Chip bg={C.warningSoft} color={C.warningDark}>Meta 2,0 dias</Chip>} />
          </div>
        </section>

        <div className="grid grid-cols-3 gap-4">
          {/* Chart card */}
          <Card className="p-5 col-span-2">
            <SectionLabel extra={<div className="flex gap-1">
              {["Diário", "Semanal", "Mensal"].map((t, i) => (
                <button key={t} className="text-[11px] px-2 py-1 rounded-[4px] font-medium" style={{ background: i === 2 ? C.infoSoft : "transparent", color: i === 2 ? C.primaryDark : C.n700 }}>{t}</button>
              ))}
            </div>}>Evolução de pagamentos (R$ milhões)</SectionLabel>

            <div className="h-[220px] flex items-end gap-2 px-2">
              {[
                { m: "Nov", v: 32 }, { m: "Dez", v: 45 }, { m: "Jan", v: 38 },
                { m: "Fev", v: 52 }, { m: "Mar", v: 44 }, { m: "Abr", v: 68, current: true },
              ].map((b) => (
                <div key={b.m} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-full flex flex-col items-center gap-1 flex-1 justify-end">
                    <span className="text-[10px] font-medium tabular-nums" style={{ color: C.n700 }}>{b.v}</span>
                    <div
                      className="w-full rounded-t-[4px]"
                      style={{
                        height: `${b.v * 2.4}px`,
                        background: b.current
                          ? `linear-gradient(180deg, ${C.primary} 0%, ${C.primaryDark} 100%)`
                          : C.primarySoft,
                      }}
                    />
                  </div>
                  <span className="text-[11px]" style={{ color: b.current ? C.primary : C.n700, fontWeight: b.current ? 500 : 400 }}>{b.m}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Insight IA */}
          <Card className="p-5" style={{ borderLeft: `4px solid ${C.accent}` }}>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4" style={{ color: C.accent }} />
              <span className="text-[11px] font-medium uppercase" style={{ color: C.accent, letterSpacing: "0.08em" }}>Insights IA</span>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: C.n900 }}>
              A concentração de pagamento em <strong>Clínica Cardio Star</strong> subiu de 18% para <strong>26%</strong> em 60 dias.
            </p>
            <ul className="mt-3 space-y-2 text-[12px]" style={{ color: C.n800 }}>
              <li className="flex gap-2"><span style={{ color: C.accent }}>·</span> Rever tabela diferenciada — vence em 12 dias</li>
              <li className="flex gap-2"><span style={{ color: C.accent }}>·</span> 3 médicos sem regra cadastrada nesta empresa</li>
              <li className="flex gap-2"><span style={{ color: C.accent }}>·</span> Divergência recorrente em TUSS 40803110</li>
            </ul>
            <button className="mt-4 text-[12px] font-medium inline-flex items-center gap-1" style={{ color: C.primary }}>
              Ver análise completa <ChevronRight className="h-3 w-3" />
            </button>
          </Card>
        </div>

        {/* Fila de lotes */}
        <section>
          <SectionLabel extra={<button className="text-[11.5px] font-medium inline-flex items-center gap-1" style={{ color: C.primary }}>Ver todos <ChevronRight className="h-3 w-3" /></button>}>
            Lotes em andamento
          </SectionLabel>
          <Card style={{ overflow: "hidden" }}>
            {[
              { name: "Empresas Prioridades — Abril 2026", val: "R$ 409.662,14", st: "Em revisão", stKind: "info", who: "Ana Martins", eta: "há 2h" },
              { name: "Cirurgia Star — Março 2026", val: "R$ 612.450,00", st: "Atrasado", stKind: "danger", who: "Roberto Lima", eta: "há 3 dias" },
              { name: "Anestesia DF — Março 2026", val: "R$ 287.330,00", st: "Aprovado", stKind: "success", who: "Ana Martins", eta: "há 5h" },
              { name: "Parecer Clínico — Abril 2026", val: "R$ 118.940,00", st: "Aguarda aprovação", stKind: "warning", who: "—", eta: "há 30min" },
            ].map((r, i, a) => {
              const stMap = {
                success: { bg: C.successSoft, color: C.successDark, Icon: CheckCircle2 },
                warning: { bg: C.warningSoft, color: C.warningDark, Icon: Clock },
                danger: { bg: C.errorSoft, color: C.error, Icon: AlertTriangle },
                info: { bg: C.infoSoft, color: C.primaryDark, Icon: Clock },
              } as const;
              const st = stMap[r.stKind as keyof typeof stMap];
              return (
                <div key={i} className="grid grid-cols-12 gap-3 px-4 py-3 items-center" style={i < a.length - 1 ? { borderBottom: `1px solid ${C.n200}` } : undefined}>
                  <span className="col-span-5 text-[13px] font-medium truncate" style={{ color: C.n900 }}>{r.name}</span>
                  <span className="col-span-2 text-[12px]" style={{ color: C.n700 }}>{r.who}</span>
                  <span className="col-span-2 text-[12px]" style={{ color: C.n700 }}>{r.eta}</span>
                  <span className="col-span-2 text-right text-[13px] font-medium tabular-nums" style={{ color: C.n900 }}>{r.val}</span>
                  <span className="col-span-1 flex justify-end"><Chip bg={st.bg} color={st.color} Icon={st.Icon}>{r.st}</Chip></span>
                </div>
              );
            })}
          </Card>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen 2 — Lote detail
// ---------------------------------------------------------------------------

function ScreenLote() {
  const rows = [
    { atend: "12034571", med: "Dra. Mariana Alves de Souza", emp: "Clínica Cardio Star Ltda", val: "R$ 12.480,00", diff: "+R$ 320,00", st: "Divergente", stKind: "warning" as const },
    { atend: "12034588", med: "Dr. Ricardo Menezes", emp: "Anestesia DF Serviços", val: "R$ 8.940,00", diff: "R$ 0,00", st: "Conciliado", stKind: "success" as const },
    { atend: "12034612", med: "Dra. Beatriz Nogueira", emp: "Ortopedia Brasília SS", val: "R$ 22.130,50", diff: "−R$ 1.240,00", st: "Sem regra", stKind: "danger" as const },
    { atend: "12034645", med: "Dr. Felipe Andrade", emp: "Neurocirurgia Star", val: "R$ 15.760,00", diff: "R$ 0,00", st: "Conciliado", stKind: "success" as const },
    { atend: "12034701", med: "Dra. Camila Ribeiro", emp: "Clínica Cardio Star Ltda", val: "R$ 9.320,00", diff: "+R$ 45,00", st: "Em revisão", stKind: "info" as const },
  ];
  const stMap = {
    success: { bg: C.successSoft, color: C.successDark, Icon: CheckCircle2 },
    warning: { bg: C.warningSoft, color: C.warningDark, Icon: AlertTriangle },
    danger: { bg: C.errorSoft, color: C.error, Icon: AlertTriangle },
    info: { bg: C.infoSoft, color: C.primaryDark, Icon: Clock },
  } as const;
  return (
    <>
      <BrandBanner
        eyebrow="Lote de pagamento"
        title="Empresas Prioridades — Abril 2026"
        meta={
          <>
            <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Competência 04/2026</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> 14 empresas · 87 médicos</span>
            <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> 333 itens</span>
          </>
        }
        actions={
          <>
            <Button variant="secondary">Devolver ao analista</Button>
            <Button variant="accent">Aprovar lote</Button>
          </>
        }
      />
      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        <section>
          <SectionLabel>Resumo do lote</SectionLabel>
          <div className="grid grid-cols-4 gap-4">
            <Kpi label="Total do lote" value="R$ 409.662,14" tone="primary" />
            <Kpi label="Divergências" value="24" tone="danger" sub={<Chip bg={C.errorSoft} color={C.error} Icon={AlertTriangle}>7% dos itens</Chip>} />
            <Kpi label="Sem regra" value="9" tone="warning" sub={<Chip bg={C.warningSoft} color={C.warningDark}>Requer cadastro</Chip>} />
            <Kpi label="Conciliados" value="300" tone="success" sub={<Chip bg={C.successSoft} color={C.successDark}>90% do lote</Chip>} />
          </div>
        </section>

        <Card className="p-5" style={{ borderLeft: `4px solid ${C.accent}` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" style={{ color: C.accent }} />
              <span className="text-[11px] font-medium uppercase" style={{ color: C.accent, letterSpacing: "0.08em" }}>Resumo IA</span>
              <Chip bg={C.successSoft} color={C.successDark}>Risco baixo</Chip>
            </div>
            <span className="text-[11.5px]" style={{ color: C.n700 }}>Reanalisado há 2 min</span>
          </div>
          <p className="text-[14px] leading-relaxed" style={{ color: C.n900 }}>
            Lote de <strong>R$ 409.662,14</strong> distribuído entre 14 empresas com 3% de itens em alerta (9/333), sem concentração crítica de risco.
          </p>
          <ul className="mt-2 space-y-1 text-[12.5px]" style={{ color: C.n800 }}>
            <li>· Maior prestador concentra <strong style={{ color: C.n900 }}>26%</strong> do valor total (Clínica Cardio Star Ltda)</li>
            <li>· <strong style={{ color: C.error }}>24 itens</strong> reprovados sem exceção autorizada</li>
            <li>· Divergência média por médico: <strong style={{ color: C.n900 }}>R$ 128,40</strong></li>
          </ul>
        </Card>

        <section>
          <SectionLabel extra={<div className="flex gap-2"><Button variant="secondary" Icon={Filter} size="sm">Filtros</Button><Button size="sm">Exportar</Button></div>}>
            Itens do lote
          </SectionLabel>
          <Card style={{ overflow: "hidden" }}>
            <div
              className="grid grid-cols-12 gap-3 px-4 py-2.5 text-[10.5px] font-medium uppercase"
              style={{ color: C.n700, letterSpacing: "0.08em", background: C.n100, borderBottom: `2px solid ${C.n200}` }}
            >
              <span className="col-span-2">Atendimento</span>
              <span className="col-span-4">Médico</span>
              <span className="col-span-3">Empresa</span>
              <span className="col-span-1 text-right">Valor</span>
              <span className="col-span-1 text-right">Diferença</span>
              <span className="col-span-1">Status</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.atend} className="grid grid-cols-12 gap-3 px-4 py-3 text-[12.5px] items-center" style={i < rows.length - 1 ? { borderBottom: `1px solid ${C.n200}` } : undefined}>
                <span className="col-span-2 tabular-nums font-medium" style={{ color: C.primary }}>{r.atend}</span>
                <span className="col-span-4 truncate" style={{ color: C.n900 }}>{r.med}</span>
                <span className="col-span-3 truncate" style={{ color: C.n800 }}>{r.emp}</span>
                <span className="col-span-1 text-right tabular-nums font-medium" style={{ color: C.n900 }}>{r.val}</span>
                <span className="col-span-1 text-right tabular-nums" style={{ color: r.diff.startsWith("−") ? C.error : r.diff.startsWith("+") ? C.warningDark : C.n700 }}>
                  {r.diff}
                </span>
                <span className="col-span-1"><Chip bg={stMap[r.stKind].bg} color={stMap[r.stKind].color} Icon={stMap[r.stKind].Icon}>{r.st}</Chip></span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — Regras
// ---------------------------------------------------------------------------

function ScreenRegras() {
  const rules = [
    { name: "Cardiologia — Cirurgião Principal", scope: "Clínica Cardio Star · Bradesco", method: "% Convênio", pct: "100%", status: "Ativa", stKind: "success" as const, updated: "há 4 dias" },
    { name: "Anestesia — Tabela Diferenciada 2026", scope: "Anestesia DF Serviços · Todos", method: "Tabela diferenciada", pct: "200%", status: "Ativa", stKind: "success" as const, updated: "há 12 dias" },
    { name: "Ortopedia — Primeiro Auxiliar", scope: "Ortopedia Brasília · Amil", method: "% Convênio", pct: "30%", status: "Rascunho", stKind: "warning" as const, updated: "há 1 dia" },
    { name: "Parecer Clínico — Valor Fixo", scope: "Todas as empresas · Todos", method: "Valor fixo", pct: "R$ 180", status: "Ativa", stKind: "success" as const, updated: "há 30 dias" },
    { name: "Neurocirurgia — Pacote Fechado", scope: "Neurocirurgia Star · SulAmérica", method: "Pacote", pct: "R$ 12.400", status: "Vencendo", stKind: "warning" as const, updated: "vence em 12 dias" },
    { name: "Bônus Paciente — Oncologia", scope: "Oncoclínicas · Unimed", method: "Bônus paciente", pct: "R$ 850", status: "Inativa", stKind: "default" as const, updated: "há 90 dias" },
  ];
  const stMap = {
    success: { bg: C.successSoft, color: C.successDark, Icon: CheckCircle2 },
    warning: { bg: C.warningSoft, color: C.warningDark, Icon: Clock },
    default: { bg: C.n200, color: C.n700, Icon: undefined },
  } as const;
  return (
    <>
      <BrandBanner
        eyebrow="Biblioteca de regras"
        title="Regras de repasse médico"
        meta={
          <>
            <span className="inline-flex items-center gap-1"><Sliders className="h-3.5 w-3.5" /> 148 regras ativas</span>
            <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> 6 vencendo em 30 dias</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> 12 empresas cobertas</span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" Icon={Play}>Simular</Button>
            <Button variant="accent" Icon={Plus}>Nova regra</Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        <section>
          <SectionLabel>Cobertura</SectionLabel>
          <div className="grid grid-cols-4 gap-4">
            <Kpi label="Regras ativas" value="148" tone="primary" />
            <Kpi label="Rascunhos" value="7" tone="warning" sub="Aguardando publicação" />
            <Kpi label="Vencendo em 30 dias" value="6" tone="danger" sub={<Chip bg={C.errorSoft} color={C.error}>Renovar</Chip>} />
            <Kpi label="Sem cobertura" value="12" sub="médicos sem regra" />
          </div>
        </section>

        <div className="grid grid-cols-4 gap-4">
          <div className="col-span-1 space-y-3">
            <Card className="p-4">
              <p className="text-[11px] font-medium uppercase mb-3" style={{ color: C.n700, letterSpacing: "0.08em" }}>Filtrar por método</p>
              {[
                { l: "% Convênio", n: 62, active: true },
                { l: "Tabela diferenciada", n: 34 },
                { l: "Valor fixo", n: 28 },
                { l: "Pacote", n: 15 },
                { l: "Bônus paciente", n: 9 },
              ].map((f) => (
                <button
                  key={f.l}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded-[4px] text-[12.5px] mb-0.5"
                  style={{
                    background: f.active ? C.infoSoft : "transparent",
                    color: f.active ? C.primaryDark : C.n800,
                    fontWeight: f.active ? 500 : 400,
                  }}
                >
                  <span>{f.l}</span>
                  <span className="text-[11px] tabular-nums" style={{ color: C.n700 }}>{f.n}</span>
                </button>
              ))}
            </Card>
            <Card className="p-4">
              <p className="text-[11px] font-medium uppercase mb-3" style={{ color: C.n700, letterSpacing: "0.08em" }}>Status</p>
              {[
                { l: "Ativa", c: C.success, n: 148 },
                { l: "Rascunho", c: C.warning, n: 7 },
                { l: "Vencendo", c: C.accent, n: 6 },
                { l: "Inativa", c: C.n500, n: 23 },
              ].map((s) => (
                <div key={s.l} className="flex items-center justify-between text-[12.5px] py-1">
                  <span className="inline-flex items-center gap-2" style={{ color: C.n800 }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: s.c }} />
                    {s.l}
                  </span>
                  <span className="tabular-nums" style={{ color: C.n700 }}>{s.n}</span>
                </div>
              ))}
            </Card>
          </div>

          <div className="col-span-3 space-y-3">
            <Card style={{ overflow: "hidden" }}>
              <div className="grid grid-cols-12 gap-3 px-4 py-2.5 text-[10.5px] font-medium uppercase" style={{ color: C.n700, letterSpacing: "0.08em", background: C.n100, borderBottom: `2px solid ${C.n200}` }}>
                <span className="col-span-4">Regra</span>
                <span className="col-span-3">Método</span>
                <span className="col-span-1 text-right">Valor</span>
                <span className="col-span-2">Status</span>
                <span className="col-span-2 text-right">Atualização</span>
              </div>
              {rules.map((r, i) => (
                <div key={i} className="grid grid-cols-12 gap-3 px-4 py-3 items-center text-[12.5px]" style={i < rules.length - 1 ? { borderBottom: `1px solid ${C.n200}` } : undefined}>
                  <div className="col-span-4 min-w-0">
                    <p className="font-medium truncate" style={{ color: C.n900 }}>{r.name}</p>
                    <p className="truncate text-[11.5px]" style={{ color: C.n700 }}>{r.scope}</p>
                  </div>
                  <span className="col-span-3" style={{ color: C.n800 }}>{r.method}</span>
                  <span className="col-span-1 text-right tabular-nums font-medium" style={{ color: C.primary }}>{r.pct}</span>
                  <span className="col-span-2">
                    <Chip bg={stMap[r.stKind].bg} color={stMap[r.stKind].color} Icon={stMap[r.stKind].Icon}>{r.status}</Chip>
                  </span>
                  <span className="col-span-2 text-right text-[11.5px]" style={{ color: C.n700 }}>
                    {r.updated}
                    <button className="ml-2 h-6 w-6 rounded-[4px] hover:bg-[color:var(--n2)] inline-flex items-center justify-center"
                      style={{ ["--n2" as string]: C.n200 } as React.CSSProperties} aria-label="Mais">
                      <MoreHorizontal className="h-3.5 w-3.5" style={{ color: C.n700 }} />
                    </button>
                  </span>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen 4 — Conciliação
// ---------------------------------------------------------------------------

function ScreenConciliacao() {
  const pairs = [
    { atend: "12034571", tuss: "40803110", med: "Dra. Mariana Alves", hosp: "R$ 12.160,00", exacta: "R$ 12.480,00", diff: "+R$ 320,00", st: "Divergente", stKind: "warning" as const },
    { atend: "12034588", tuss: "31602010", med: "Dr. Ricardo Menezes", hosp: "R$ 8.940,00", exacta: "R$ 8.940,00", diff: "R$ 0,00", st: "OK", stKind: "success" as const },
    { atend: "12034612", tuss: "40901093", med: "Dra. Beatriz Nogueira", hosp: "R$ 23.370,50", exacta: "R$ 22.130,50", diff: "−R$ 1.240,00", st: "Divergente", stKind: "danger" as const },
    { atend: "12034645", tuss: "31702025", med: "Dr. Felipe Andrade", hosp: "R$ 15.760,00", exacta: "R$ 15.760,00", diff: "R$ 0,00", st: "OK", stKind: "success" as const },
    { atend: "12034812", tuss: "40803110", med: "Dr. João Cunha", hosp: "R$ 3.240,00", exacta: "—", diff: "Só no hospital", stKind: "danger" as const },
    { atend: "12034990", tuss: "40901101", med: "Dra. Camila Ribeiro", hosp: "—", exacta: "R$ 9.320,00", diff: "Só no Exacta", stKind: "warning" as const },
  ];
  const stMap = {
    success: { bg: C.successSoft, color: C.successDark, Icon: CheckCircle2 },
    warning: { bg: C.warningSoft, color: C.warningDark, Icon: AlertTriangle },
    danger: { bg: C.errorSoft, color: C.error, Icon: AlertTriangle },
  } as const;
  return (
    <>
      <BrandBanner
        eyebrow="Conciliação"
        title="Hospital × Exacta — Abril 2026"
        meta={
          <>
            <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> 337 linhas hospital · 333 Exacta</span>
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Chave: atendimento + TUSS + médico</span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" Icon={Filter}>Filtros</Button>
            <Button variant="accent">Fechar conciliação</Button>
          </>
        }
      />

      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        <section>
          <SectionLabel>Situação geral</SectionLabel>
          <div className="grid grid-cols-4 gap-4">
            <Kpi label="Conciliados" value="298" tone="success" sub={<Chip bg={C.successSoft} color={C.successDark}>89,5%</Chip>} />
            <Kpi label="Divergência de valor" value="26" tone="warning" sub="R$ 42.180 em disputa" />
            <Kpi label="Só no hospital" value="9" tone="danger" sub="R$ 18.240 pendentes" />
            <Kpi label="Só no Exacta" value="4" tone="warning" sub="R$ 7.120 sem contrapartida" />
          </div>
        </section>

        {/* Barra de progresso */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[12.5px] font-medium" style={{ color: C.n900 }}>Progresso da conciliação</p>
            <p className="text-[11.5px]" style={{ color: C.n700 }}>298 de 333 itens · 89,5%</p>
          </div>
          <div className="h-2 rounded-full overflow-hidden flex" style={{ background: C.n200 }}>
            <div style={{ width: "76%", background: C.success }} />
            <div style={{ width: "8%", background: C.warning }} />
            <div style={{ width: "5,5%", background: C.error }} />
          </div>
          <div className="flex items-center gap-4 mt-3 text-[11.5px]" style={{ color: C.n700 }}>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.success }} /> Conciliado 76%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.warning }} /> Divergente 8%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.error }} /> Não pareado 5,5%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: C.n300 }} /> Aguardando 10,5%</span>
          </div>
        </Card>

        <section>
          <SectionLabel>Itens conciliados</SectionLabel>
          <Card style={{ overflow: "hidden" }}>
            <div className="grid grid-cols-12 gap-3 px-4 py-2.5 text-[10.5px] font-medium uppercase" style={{ color: C.n700, letterSpacing: "0.08em", background: C.n100, borderBottom: `2px solid ${C.n200}` }}>
              <span className="col-span-2">Atendimento</span>
              <span className="col-span-1">TUSS</span>
              <span className="col-span-3">Médico</span>
              <span className="col-span-2 text-right">Hospital</span>
              <span className="col-span-2 text-right">Exacta</span>
              <span className="col-span-1 text-right">Diferença</span>
              <span className="col-span-1">Status</span>
            </div>
            {pairs.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-3 px-4 py-3 items-center text-[12.5px]" style={i < pairs.length - 1 ? { borderBottom: `1px solid ${C.n200}` } : undefined}>
                <span className="col-span-2 tabular-nums font-medium" style={{ color: C.primary }}>{r.atend}</span>
                <span className="col-span-1 tabular-nums" style={{ color: C.n700 }}>{r.tuss}</span>
                <span className="col-span-3 truncate" style={{ color: C.n900 }}>{r.med}</span>
                <span className="col-span-2 text-right tabular-nums" style={{ color: r.hosp === "—" ? C.n500 : C.n800 }}>{r.hosp}</span>
                <span className="col-span-2 text-right tabular-nums" style={{ color: r.exacta === "—" ? C.n500 : C.n800 }}>{r.exacta}</span>
                <span className="col-span-1 text-right tabular-nums text-[11.5px]" style={{
                  color: r.diff.startsWith("−") || r.diff.startsWith("Só no h") ? C.error :
                         r.diff.startsWith("+") || r.diff.startsWith("Só no E") ? C.warningDark : C.n700
                }}>{r.diff}</span>
                <span className="col-span-1"><Chip bg={stMap[r.stKind].bg} color={stMap[r.stKind].color} Icon={stMap[r.stKind].Icon}>{r.st}</Chip></span>
              </div>
            ))}
          </Card>
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------

function ExactaCuraMockup() {
  const [screen, setScreen] = useState<NavKey>("dashboard");
  const crumbMap: Record<NavKey, string[]> = {
    dashboard: ["Dashboard"],
    lote: ["Pagamentos", "Empresas Prioridades Abril 2026"],
    regras: ["Configurações", "Regras de repasse"],
    conciliacao: ["Conciliação", "Abril 2026"],
  };
  return (
    <div
      className="flex overflow-hidden"
      style={{ background: C.n100, color: C.n800, fontFamily: font, height: 960, border: `2px solid ${C.n300}`, borderRadius: 8 }}
    >
      <Sidebar active={screen} onChange={setScreen} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar crumb={crumbMap[screen]} />
        {screen === "dashboard" && <ScreenDashboard />}
        {screen === "lote" && <ScreenLote />}
        {screen === "regras" && <ScreenRegras />}
        {screen === "conciliacao" && <ScreenConciliacao />}
      </div>
    </div>
  );
}

export default function PreviewCura() {
  return (
    <div className="min-h-screen p-6" style={{ background: C.n100, fontFamily: font }}>
      <div className="max-w-[1600px] mx-auto">
        <header className="mb-5">
          <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: C.n700 }}>
            Mockup — Design System
          </div>
          <h1 className="text-[24px] font-medium mt-1" style={{ color: C.n900 }}>
            Exacta no Design System CURA
            <span style={{ color: C.n700, fontSize: 14, marginLeft: 8 }}>
              (Rede D'Or · projeto App Médico MVP)
            </span>
          </h1>
          <p className="text-[13px] mt-1" style={{ color: C.n700 }}>
            Navegue pelas telas na barra lateral: <strong>Dashboard</strong>, <strong>Pagamentos</strong> (detalhe de lote),{" "}
            <strong>Regras</strong> e <strong>Conciliação</strong>. Tokens: azul <code style={{ color: C.primary }}>#003DA5</code>,
            acento <code style={{ color: C.accent }}>#FF8200</code>, neutros Cura, radius 4/8, borda 2px, sombra Cura, Gotham.
          </p>
        </header>
        <ExactaCuraMockup />
        <p className="text-[11.5px] mt-6 text-center" style={{ color: C.n700 }}>
          Tela isolada — não altera o tema atual do Exacta. Serve apenas para validar direção visual antes de portar tokens.
        </p>
      </div>
    </div>
  );
}

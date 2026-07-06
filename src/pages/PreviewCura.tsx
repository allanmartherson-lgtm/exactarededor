import { AlertTriangle, Bell, Calendar, CheckCircle2, ChevronRight, Clock, FileText, MapPin, MoreHorizontal, Search, Settings, Users } from "lucide-react";

/**
 * Mockup — Exacta renderizado com o Design System CURA (Rede D'Or).
 * Acesse em /preview-cura
 *
 * Tokens hard-coded a partir do projeto "APP Médico Rede D'Or MVP - Entrega 01 - DS"
 * (src/styles.css). NÃO usa o tema atual do Exacta — tela isolada para comparação.
 *
 * Referência de tokens Cura:
 *  primary base   #003DA5   dark #003075   darker #002855   light #71C5E8
 *  accent base    #FF8200   (bronze/laranja Cura)
 *  neutral 0..900 #FFFFFF · #F6F6F6 · #E9E9E9 · #D4D4D4 · #B7B7B7 · #4A4A4A · #262626
 *  success #5FD290 · warning #F5EF4E · error #CE2A2A · info #6EA8FF
 *  radius botões 4px · cards 8px · borda 2px
 *  fonte Gotham (fallback Arial/Helvetica)
 */

const C = {
  primary: "#003DA5",
  primaryDark: "#003075",
  primaryDarker: "#002855",
  primaryLight: "#71C5E8",
  accent: "#FF8200",
  accentSoft: "#FFC27B",
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

function Chip({
  children,
  bg,
  color,
  Icon,
}: {
  children: React.ReactNode;
  bg: string;
  color: string;
  Icon?: typeof Clock;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-[4px]"
      style={{ background: bg, color, letterSpacing: "0.02em" }}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[11px] font-medium uppercase mb-3"
      style={{ color: C.n700, letterSpacing: "0.08em" }}
    >
      {children}
    </p>
  );
}

function Sidebar() {
  const items = [
    { label: "Início", Icon: MapPin, active: false },
    { label: "Pagamentos", Icon: FileText, active: true, badge: 12 },
    { label: "Pendências", Icon: AlertTriangle, badge: 4 },
    { label: "Conciliação", Icon: CheckCircle2 },
    { label: "Cadastros", Icon: Users },
    { label: "Relatórios", Icon: FileText },
    { label: "Configurações", Icon: Settings },
  ];
  return (
    <aside
      className="w-[232px] shrink-0 flex flex-col"
      style={{ background: C.n0, borderRight: `2px solid ${C.n200}` }}
    >
      <div
        className="px-5 h-16 flex items-center gap-2"
        style={{ borderBottom: `2px solid ${C.n200}` }}
      >
        <div
          className="h-9 w-9 rounded-full grid place-items-center"
          style={{ background: C.primary }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M5 12l4 4 10-10" stroke={C.accentSoft} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-medium" style={{ color: C.n900, fontFamily: font }}>
            E<span style={{ color: C.accent }}>x</span>acta
          </div>
          <div className="text-[9px] font-medium tracking-[0.18em]" style={{ color: C.n700 }}>
            REDE D'OR
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((it) => (
          <button
            key={it.label}
            className="w-full flex items-center gap-3 px-3 h-9 rounded-[4px] text-[13px] transition-colors"
            style={{
              background: it.active ? C.infoSoft : "transparent",
              color: it.active ? C.primaryDark : C.n800,
              fontWeight: it.active ? 500 : 400,
              borderLeft: it.active ? `3px solid ${C.primary}` : "3px solid transparent",
            }}
          >
            <it.Icon className="h-4 w-4" strokeWidth={2} />
            <span className="flex-1 text-left">{it.label}</span>
            {it.badge != null && (
              <span
                className="text-[10px] font-semibold px-1.5 h-4 rounded-full grid place-items-center"
                style={{ background: C.primary, color: C.n0, minWidth: 16 }}
              >
                {it.badge}
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="px-4 py-3 text-[11px]" style={{ color: C.n700, borderTop: `2px solid ${C.n200}` }}>
        Hospital DF Star · Abril/2026
      </div>
    </aside>
  );
}

function Header() {
  return (
    <header
      className="h-16 px-6 flex items-center justify-between shrink-0"
      style={{
        background: C.primary,
        color: C.n0,
        // sobrescreve variável interna do CURA para textos brancos no header azul
        ["--cura-font-color" as string]: C.n0,
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-3">
        <div className="text-[11px] uppercase tracking-[0.12em] opacity-80">Pagamentos</div>
        <ChevronRight className="h-3 w-3 opacity-60" />
        <div className="text-[14px] font-medium">Lote Empresas Prioridades Abril 2026</div>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex items-center gap-2 h-9 px-3 rounded-[4px]"
          style={{ background: C.n0, color: C.n800, width: 300 }}
        >
          <Search className="h-4 w-4" style={{ color: C.n500 }} />
          <input
            placeholder="Buscar por atendimento, médico ou empresa"
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-[color:var(--ph)]"
            style={{ ["--ph" as string]: C.n500 } as React.CSSProperties}
          />
        </div>
        <button
          className="h-9 w-9 rounded-[4px] grid place-items-center relative"
          style={{ background: "rgba(255,255,255,0.10)" }}
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
          <span
            className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full text-[10px] font-semibold grid place-items-center"
            style={{ background: C.error, color: C.n0 }}
          >
            3
          </span>
        </button>
        <div
          className="h-9 w-9 rounded-full grid place-items-center text-[12px] font-semibold"
          style={{ background: C.primaryLight, color: C.n900 }}
        >
          AM
        </div>
      </div>
    </header>
  );
}

function KpiCard({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: React.ReactNode; tone?: "default" | "danger" | "warning" | "success" }) {
  const toneColor = tone === "danger" ? C.error : tone === "warning" ? C.warningDark : tone === "success" ? C.successDark : C.n900;
  return (
    <div className="p-4" style={{ background: C.n0, border: CARD_BORDER, borderRadius: 8, boxShadow: SHADOW }}>
      <p className="text-[11px] font-medium uppercase" style={{ color: C.n700, letterSpacing: "0.08em" }}>
        {label}
      </p>
      <p className="text-[24px] font-medium mt-1 tabular-nums leading-tight" style={{ color: toneColor }}>
        {value}
      </p>
      {sub && <div className="mt-2 text-[11.5px]" style={{ color: C.n700 }}>{sub}</div>}
    </div>
  );
}

function Table() {
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
    <div style={{ background: C.n0, border: CARD_BORDER, borderRadius: 8, boxShadow: SHADOW, overflow: "hidden" }}>
      <div
        className="grid grid-cols-12 gap-3 px-4 py-2.5 text-[10.5px] font-medium uppercase tabular-nums"
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
        <div
          key={r.atend}
          className="grid grid-cols-12 gap-3 px-4 py-3 text-[12.5px] items-center"
          style={i < rows.length - 1 ? { borderBottom: `1px solid ${C.n200}` } : undefined}
        >
          <span className="col-span-2 tabular-nums font-medium" style={{ color: C.primary }}>{r.atend}</span>
          <span className="col-span-4 truncate" style={{ color: C.n900 }}>{r.med}</span>
          <span className="col-span-3 truncate" style={{ color: C.n800 }}>{r.emp}</span>
          <span className="col-span-1 text-right tabular-nums font-medium" style={{ color: C.n900 }}>{r.val}</span>
          <span
            className="col-span-1 text-right tabular-nums"
            style={{ color: r.diff.startsWith("−") ? C.error : r.diff.startsWith("+") ? C.warningDark : C.n700 }}
          >
            {r.diff}
          </span>
          <span className="col-span-1">
            <Chip bg={stMap[r.stKind].bg} color={stMap[r.stKind].color} Icon={stMap[r.stKind].Icon}>
              {r.st}
            </Chip>
          </span>
        </div>
      ))}
    </div>
  );
}

function ExactaCuraMockup() {
  return (
    <div
      className="flex overflow-hidden"
      style={{ background: C.n100, color: C.n800, fontFamily: font, height: 900, border: `2px solid ${C.n300}`, borderRadius: 8 }}
    >
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />

        {/* Faixa institucional (bloco identidade Cura) */}
        <div
          className="px-8 py-5 flex items-center justify-between"
          style={{
            background: `linear-gradient(135deg, ${C.primaryDarker} 0%, ${C.primary} 60%, ${C.primaryLight} 140%)`,
            color: C.n0,
          }}
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.12em] opacity-80">Lote de pagamento</p>
            <h1 className="text-[22px] font-medium mt-1 leading-tight" style={{ letterSpacing: "-0.01em" }}>
              Empresas Prioridades — Abril 2026
            </h1>
            <div className="flex items-center gap-4 mt-2 text-[12px] opacity-90">
              <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Competência 04/2026</span>
              <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" /> 14 empresas · 87 médicos</span>
              <span className="inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" /> 333 itens</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="h-9 px-4 text-[13px] font-medium rounded-[4px]"
              style={{ background: "rgba(255,255,255,0.14)", color: C.n0, border: "1px solid rgba(255,255,255,0.3)" }}
            >
              Devolver ao analista
            </button>
            <button
              className="h-9 px-4 text-[13px] font-medium rounded-[4px]"
              style={{ background: C.accent, color: C.n0 }}
            >
              Aprovar lote
            </button>
          </div>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
          {/* KPIs */}
          <section>
            <SectionLabel>Resumo do lote</SectionLabel>
            <div className="grid grid-cols-4 gap-4">
              <KpiCard label="Total em aberto" value="R$ 1.750.983,72" sub={<Chip bg={C.infoSoft} color={C.primaryDark}>5 lotes ativos</Chip>} />
              <KpiCard label="Lotes atrasados" value="4" tone="danger" sub={<Chip bg={C.errorSoft} color={C.error} Icon={AlertTriangle}>SLA estourado</Chip>} />
              <KpiCard label="Aguardando validação" value="12" sub={<span>Analista: Ana Martins</span>} />
              <KpiCard label="Aguardando aprovação" value="3" tone="warning" sub={<Chip bg={C.warningSoft} color={C.warningDark}>Comp. 03/2026</Chip>} />
            </div>
          </section>

          {/* Resumo IA (card destacado) */}
          <section
            className="p-5"
            style={{
              background: C.n0,
              border: CARD_BORDER,
              borderRadius: 8,
              boxShadow: SHADOW,
              borderLeft: `4px solid ${C.accent}`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: C.accent }}>
                  Resumo IA
                </span>
                <Chip bg={C.successSoft} color={C.successDark}>Risco baixo</Chip>
              </div>
              <span className="text-[11.5px]" style={{ color: C.n700 }}>Reanalisado há 2 min</span>
            </div>
            <p className="text-[14px] leading-relaxed" style={{ color: C.n900 }}>
              Lote de <strong>R$ 409.662,14</strong> distribuído entre 14 empresas com 3% de itens em alerta (9/333),
              sem concentração crítica de risco.
            </p>
            <ul className="mt-2 space-y-1 text-[12.5px]" style={{ color: C.n800 }}>
              <li>· Maior prestador concentra <strong style={{ color: C.n900 }}>26%</strong> do valor total (Clínica Cardio Star Ltda)</li>
              <li>· <strong style={{ color: C.error }}>24 itens</strong> reprovados sem exceção autorizada</li>
              <li>· Divergência média por médico: <strong style={{ color: C.n900 }}>R$ 128,40</strong></li>
            </ul>
          </section>

          {/* Tabela */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <SectionLabel>Itens do lote</SectionLabel>
              <div className="flex items-center gap-2">
                <button
                  className="h-8 px-3 text-[12px] font-medium rounded-[4px]"
                  style={{ background: C.n0, border: `2px solid ${C.n400}`, color: C.n800 }}
                >
                  Filtros
                </button>
                <button
                  className="h-8 px-3 text-[12px] font-medium rounded-[4px]"
                  style={{ background: C.primary, color: C.n0 }}
                >
                  Exportar
                </button>
              </div>
            </div>
            <Table />
          </section>
        </div>
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
            Exacta no Design System CURA <span style={{ color: C.n700, fontSize: 14, marginLeft: 8 }}>
              (Rede D'Or · projeto App Médico MVP)
            </span>
          </h1>
          <p className="text-[13px] mt-1" style={{ color: C.n700 }}>
            Tokens portados: azul institucional <code style={{ color: C.primary }}>#003DA5</code>, acento bronze/laranja <code style={{ color: C.accent }}>#FF8200</code>,
            neutros Cura, radius 4/8, borda 2px, sombra Cura, tipografia Gotham (fallback Arial).
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

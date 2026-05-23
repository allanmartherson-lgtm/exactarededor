import { AlertTriangle, CheckCircle2, Clock, ChevronRight, MoreHorizontal } from "lucide-react";

/**
 * Preview lado a lado: Apple HIG vs Atlassian Design System.
 * Acesse em /preview-design-systems
 * Tokens hard-coded — não usa o tema do app.
 */

// ---------------------------------------------------------------------------
// APPLE HIG — SF-like, generoso, translúcido, cantos arredondados grandes,
// hierarquia por peso de fonte e cor neutra, acentos em azul sistema.
// ---------------------------------------------------------------------------
function AppleHIG() {
  const C = {
    bg: "#F2F2F7",          // systemGroupedBackground
    card: "#FFFFFF",
    separator: "rgba(60,60,67,0.18)",
    label: "#1C1C1E",
    secondary: "#3C3C4399",
    tertiary: "#3C3C434D",
    blue: "#007AFF",
    blueSoft: "#E8F0FE",
    red: "#FF3B30",
    redSoft: "#FFE5E3",
    green: "#34C759",
    greenSoft: "#E3F8E8",
    orange: "#FF9500",
  };
  const font = "-apple-system, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif";
  return (
    <div className="rounded-[22px] overflow-hidden border" style={{ background: C.bg, borderColor: C.separator, fontFamily: font, color: C.label }}>
      {/* Large title nav */}
      <div className="px-6 pt-6 pb-3" style={{ background: C.bg }}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[13px]" style={{ color: C.blue }}>‹ Lotes</span>
          <span className="text-[13px]" style={{ color: C.blue }}>Editar</span>
        </div>
        <h2 className="text-[28px] font-bold tracking-tight" style={{ letterSpacing: "-0.02em" }}>Pagamentos</h2>
        <p className="text-[15px] mt-0.5" style={{ color: C.secondary }}>5 lotes ativos · Abril 2026</p>
      </div>

      {/* Search-like pill */}
      <div className="px-4 pb-3">
        <div className="rounded-[10px] px-3 py-2 text-[15px]" style={{ background: "rgba(118,118,128,0.12)", color: C.tertiary }}>
          Buscar lote ou empresa
        </div>
      </div>

      {/* Inset grouped list */}
      <div className="px-4 pb-4">
        <div className="text-[13px] uppercase tracking-wider px-3 pb-1.5" style={{ color: C.secondary, letterSpacing: "0.04em" }}>Resumo</div>
        <div className="rounded-[14px] overflow-hidden" style={{ background: C.card }}>
          {[
            { l: "Total em aberto", v: "R$ 1.750.983,72" },
            { l: "Lotes atrasados", v: "4", danger: true },
            { l: "Aguardando validação", v: "0", muted: true },
            { l: "Aguardando aprovação", v: "0", muted: true },
          ].map((k, i, a) => (
            <div key={i} className="flex items-center justify-between px-4 py-3" style={{ borderBottom: i < a.length - 1 ? `0.5px solid ${C.separator}` : "none" }}>
              <span className="text-[15px]">{k.l}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] tabular-nums" style={{ color: k.danger ? C.red : k.muted ? C.secondary : C.label, fontWeight: 600 }}>{k.v}</span>
                <ChevronRight size={16} style={{ color: C.tertiary }} />
              </div>
            </div>
          ))}
        </div>

        <div className="text-[13px] uppercase tracking-wider px-3 pt-5 pb-1.5" style={{ color: C.secondary, letterSpacing: "0.04em" }}>Lotes recentes</div>
        <div className="rounded-[14px] overflow-hidden" style={{ background: C.card }}>
          {[
            { name: "Empresas Prioridades Abril 2026", val: "R$ 409.662,14", st: "Em revisão", color: C.blue, soft: C.blueSoft, ic: Clock },
            { name: "Cirurgia Star Março 2026", val: "R$ 612.450,00", st: "Atrasado", color: C.red, soft: C.redSoft, ic: AlertTriangle },
            { name: "DF Parecer Insights Fev 2026", val: "R$ 287.330,00", st: "Aprovado", color: C.green, soft: C.greenSoft, ic: CheckCircle2 },
          ].map((r, i, a) => (
            <div key={i} className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: i < a.length - 1 ? `0.5px solid ${C.separator}` : "none" }}>
              <div className="min-w-0">
                <div className="text-[15px] font-medium truncate">{r.name}</div>
                <div className="text-[13px] mt-0.5" style={{ color: C.secondary }}>{r.val}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full font-medium" style={{ background: r.soft, color: r.color }}>
                  <r.ic className="h-3 w-3" /> {r.st}
                </span>
                <ChevronRight size={16} style={{ color: C.tertiary }} />
              </div>
            </div>
          ))}
        </div>

        {/* Bottom buttons — filled & tinted */}
        <div className="flex gap-2 mt-5 px-1">
          <button className="flex-1 text-[15px] font-semibold py-2.5 rounded-[12px] text-white" style={{ background: C.blue }}>
            Aprovar lote
          </button>
          <button className="flex-1 text-[15px] font-semibold py-2.5 rounded-[12px]" style={{ background: C.blueSoft, color: C.blue }}>
            Devolver
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ATLASSIAN DESIGN SYSTEM — densidade alta, tipografia Charlie/Inter,
// cinzas neutros N-scale, acento Atlassian blue B400, lozenges retangulares,
// hierarquia por bordas e divisores explícitos.
// ---------------------------------------------------------------------------
function Atlassian() {
  const C = {
    bg: "#F7F8F9",          // N20
    surface: "#FFFFFF",
    border: "#DCDFE4",      // N40
    borderStrong: "#B3B9C4",// N60
    text: "#172B4D",        // N900
    subtle: "#44546F",      // N300
    muted: "#626F86",
    blue: "#0C66E4",        // B400
    blueBg: "#E9F2FF",      // B50
    blueText: "#0055CC",    // B500
    red: "#C9372C",         // R400
    redBg: "#FFEDEB",       // R50
    green: "#1F845A",       // G400
    greenBg: "#DCFFF1",     // G50
    yellow: "#7F5F01",
    yellowBg: "#FFF7D6",
  };
  const font = "'Atlassian Sans', 'Charlie Text', -apple-system, 'Segoe UI', Inter, sans-serif";
  const Lozenge = ({ children, kind = "default" }: { children: React.ReactNode; kind?: "default" | "success" | "danger" | "inprogress" | "moved" }) => {
    const map = {
      default: { bg: "#091E4208", color: C.subtle },
      success: { bg: C.greenBg, color: C.green },
      danger: { bg: C.redBg, color: C.red },
      inprogress: { bg: C.blueBg, color: C.blueText },
      moved: { bg: C.yellowBg, color: C.yellow },
    } as const;
    const s = map[kind];
    return (
      <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-[3px]" style={{ background: s.bg, color: s.color, letterSpacing: "0.05em" }}>
        {children}
      </span>
    );
  };
  return (
    <div className="rounded-[3px] overflow-hidden border" style={{ background: C.bg, borderColor: C.border, fontFamily: font, color: C.text }}>
      {/* Top nav */}
      <div className="flex items-center gap-4 px-4 h-12 border-b" style={{ background: C.surface, borderColor: C.border }}>
        <div className="h-6 w-6 rounded-[3px]" style={{ background: C.blue }} />
        <span className="text-[14px] font-semibold">MedPay</span>
        <span className="text-[14px]" style={{ color: C.subtle }}>Projetos / <span style={{ color: C.text }}>Pagamentos</span></span>
        <div className="ml-auto flex items-center gap-2">
          <button className="text-[14px] font-medium px-3 h-8 rounded-[3px] text-white" style={{ background: C.blue }}>Criar</button>
          <button className="h-8 w-8 grid place-items-center rounded-[3px] hover:bg-[#091E420F]"><MoreHorizontal size={16} /></button>
        </div>
      </div>

      {/* Page */}
      <div className="p-6">
        <div className="flex items-end justify-between mb-4">
          <div>
            <div className="text-[12px]" style={{ color: C.subtle }}>Projetos / Pagamentos / Lotes</div>
            <h2 className="text-[24px] font-semibold mt-1" style={{ letterSpacing: "-0.01em" }}>Lotes em revisão</h2>
          </div>
          <div className="flex gap-2">
            <button className="text-[14px] font-medium px-3 h-8 rounded-[3px] border" style={{ borderColor: C.border, background: C.surface }}>Filtros</button>
            <button className="text-[14px] font-medium px-3 h-8 rounded-[3px] text-white" style={{ background: C.blue }}>Aprovar lote</button>
          </div>
        </div>

        {/* Stat strip */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { l: "Total em aberto", v: "R$ 1.750.983,72", lz: <Lozenge kind="inprogress">5 ativos</Lozenge> },
            { l: "Lotes atrasados", v: "4", lz: <Lozenge kind="danger">SLA</Lozenge> },
            { l: "Aguardando validação", v: "0", lz: <Lozenge>Fila</Lozenge> },
            { l: "Aguardando aprovação", v: "0", lz: <Lozenge kind="moved">Mar/2026</Lozenge> },
          ].map((k, i) => (
            <div key={i} className="rounded-[3px] border p-3" style={{ background: C.surface, borderColor: C.border }}>
              <div className="text-[12px] font-medium" style={{ color: C.subtle }}>{k.l}</div>
              <div className="text-[20px] font-semibold mt-1 tabular-nums">{k.v}</div>
              <div className="mt-2">{k.lz}</div>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="rounded-[3px] border overflow-hidden" style={{ background: C.surface, borderColor: C.border }}>
          <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[11px] font-bold uppercase tracking-wider border-b" style={{ color: C.subtle, borderColor: C.border, background: "#F7F8F9", letterSpacing: "0.05em" }}>
            <span className="col-span-5">Lote</span>
            <span className="col-span-2">Competência</span>
            <span className="col-span-2 text-right">Valor</span>
            <span className="col-span-2">Status</span>
            <span className="col-span-1 text-right">Ação</span>
          </div>
          {[
            { name: "Empresas Prioridades Abril 2026", comp: "Abril/2026", val: "R$ 409.662,14", st: <Lozenge kind="inprogress">Em revisão</Lozenge> },
            { name: "Cirurgia Star Março 2026", comp: "Março/2026", val: "R$ 612.450,00", st: <Lozenge kind="danger">Atrasado</Lozenge> },
            { name: "DF Parecer Insights Fev 2026", comp: "Fev/2026", val: "R$ 287.330,00", st: <Lozenge kind="success">Aprovado</Lozenge> },
          ].map((r, i, a) => (
            <div key={i} className="grid grid-cols-12 gap-2 px-3 py-2.5 text-[13px] items-center" style={{ borderBottom: i < a.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <span className="col-span-5 font-medium truncate" style={{ color: C.blueText }}>{r.name}</span>
              <span className="col-span-2" style={{ color: C.subtle }}>{r.comp}</span>
              <span className="col-span-2 text-right font-semibold tabular-nums">{r.val}</span>
              <span className="col-span-2">{r.st}</span>
              <span className="col-span-1 text-right"><button className="h-6 w-6 grid place-items-center rounded-[3px] hover:bg-[#091E420F] ml-auto"><MoreHorizontal size={14} /></button></span>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-2 mt-4">
          <button className="text-[14px] font-medium px-3 h-8 rounded-[3px] hover:bg-[#091E420F]" style={{ color: C.subtle }}>Cancelar</button>
          <button className="text-[14px] font-medium px-3 h-8 rounded-[3px] border" style={{ borderColor: C.border, background: C.surface }}>Devolver</button>
          <button className="text-[14px] font-medium px-3 h-8 rounded-[3px] text-white" style={{ background: C.blue }}>Aprovar</button>
        </div>
      </div>
    </div>
  );
}

export default function PreviewDesignSystems() {
  return (
    <div className="min-h-screen p-6" style={{ background: "#EEF0F3", fontFamily: "system-ui, sans-serif" }}>
      <div className="max-w-[1600px] mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: "#0B1538" }}>
            Apple HIG × Atlassian Design System
          </h1>
          <p className="text-sm mt-1" style={{ color: "#64748B" }}>
            Mesmo conteúdo renderizado nas duas linguagens. Compare densidade, hierarquia, cantos, tipografia e acentos.
          </p>
        </header>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#64748B" }}>Apple — Human Interface Guidelines</div>
            <AppleHIG />
            <p className="text-xs mt-2" style={{ color: "#64748B" }}>
              Cantos 14–22px · SF Pro · listas agrupadas com inset · acentos em azul sistema · separadores 0.5px · botões pill.
            </p>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "#64748B" }}>Atlassian — Design System</div>
            <Atlassian />
            <p className="text-xs mt-2" style={{ color: "#64748B" }}>
              Cantos 3px · Atlassian Sans · densidade alta · lozenges retangulares · azul B400 · bordas N40 explícitas.
            </p>
          </div>
        </div>
        <p className="text-xs mt-6 text-center" style={{ color: "#64748B" }}>
          Tela isolada — não usa o tema do app. Apenas para comparação visual.
        </p>
      </div>
    </div>
  );
}

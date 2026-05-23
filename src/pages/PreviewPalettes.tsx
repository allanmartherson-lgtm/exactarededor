import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

/**
 * Tela de compara\u00e7\u00e3o lado a lado de paletas de fundo.
 * Acesse em /preview-paletas
 * N\u00e3o usa tokens semantic do tema \u2014 cores hard-coded para isolar a compara\u00e7\u00e3o.
 */

type PaletteTokens = {
  name: string;
  bg: string;
  card: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  primary: string;
  primarySoft: string;
  destructive: string;
  warning: string;
  success: string;
  shadow: string;
};

const SLATE_STEEL: PaletteTokens = {
  name: "Slate & Steel",
  bg: "#F8FAFC",
  card: "#FFFFFF",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  text: "#0B1538",
  muted: "#64748B",
  primary: "#1E3A8A",
  primarySoft: "#EEF2FF",
  destructive: "#EF4444",
  warning: "#F59E0B",
  success: "#16A34A",
  shadow: "0 1px 2px 0 rgba(11,21,56,0.05), 0 4px 12px -2px rgba(11,21,56,0.08)",
};

const PURE_WHITE: PaletteTokens = {
  name: "Pure White",
  bg: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E5E7EB",
  borderStrong: "#9CA3AF",
  text: "#0B1538",
  muted: "#6B7280",
  primary: "#1E3A8A",
  primarySoft: "#EEF2FF",
  destructive: "#EF4444",
  warning: "#F59E0B",
  success: "#16A34A",
  shadow: "0 1px 2px 0 rgba(11,21,56,0.04), 0 4px 12px -2px rgba(11,21,56,0.06)",
};

function Mock({ p }: { p: PaletteTokens }) {
  return (
    <div
      className="rounded-lg overflow-hidden border"
      style={{ background: p.bg, borderColor: p.borderStrong, color: p.text, fontFamily: "'DM Sans', system-ui, sans-serif" }}
    >
      {/* Header simulado */}
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ background: p.card, borderColor: p.border }}>
        <div>
          <div className="text-[10px] uppercase tracking-wider" style={{ color: p.muted }}>Paleta</div>
          <h2 className="text-base font-semibold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
            {p.name} <span className="text-xs font-normal" style={{ color: p.muted }}>\u00b7 fundo {p.bg}</span>
          </h2>
        </div>
        <span
          className="text-[10px] px-2 py-1 rounded-md font-medium"
          style={{ background: p.primarySoft, color: p.primary }}
        >
          Em revis\u00e3o
        </span>
      </div>

      {/* Conte\u00fado */}
      <div className="p-5 space-y-4">
        {/* KPI bar */}
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md border" style={{ background: p.border, borderColor: p.border }}>
          {[
            { l: "Total em aberto", v: "R$ 1.750.983,72", sub: "5 lotes ativos" },
            { l: "Lotes atrasados", v: "4", sub: "SLA estourado", danger: true },
            { l: "Aguardando valida\u00e7\u00e3o", v: "0", sub: "Fila do validador" },
            { l: "Aguardando aprova\u00e7\u00e3o", v: "0", sub: "Comp. mar/2026" },
          ].map((k, i) => (
            <div key={i} className="p-3 text-center" style={{ background: p.card }}>
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: p.muted }}>{k.l}</p>
              <p className="text-lg font-bold mt-1 tabular-nums" style={{ color: k.danger ? p.destructive : p.text }}>{k.v}</p>
              <p className="text-[10px] mt-1" style={{ color: p.muted }}>{k.sub}</p>
            </div>
          ))}
        </div>

        {/* Card de resumo */}
        <div className="rounded-lg border p-4" style={{ background: p.card, borderColor: p.border, boxShadow: p.shadow }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: p.primary }}>Resumo IA</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "#DCFCE7", color: "#166534" }}>Risco baixo</span>
            </div>
            <span className="text-[11px]" style={{ color: p.muted }}>333 itens \u00b7 R$ 409.662,14</span>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: p.text }}>
            Lote de <strong>R$ 409.662,14</strong> distribu\u00eddo entre 14 empresas com 3% de itens em alerta (9/333), sem concentra\u00e7\u00e3o cr\u00edtica.
          </p>
          <ul className="mt-2 space-y-1 text-xs" style={{ color: p.muted }}>
            <li>\u2022 Maior prestador concentra 26% do valor total</li>
            <li>\u2022 24 itens reprovados (7% do total) sem exce\u00e7\u00f5es autorizadas</li>
          </ul>
        </div>

        {/* Tabela */}
        <div className="rounded-lg border overflow-hidden" style={{ background: p.card, borderColor: p.border, boxShadow: p.shadow }}>
          <div className="px-4 py-2 border-b text-[10px] font-bold uppercase tracking-wider grid grid-cols-12 gap-2" style={{ borderColor: p.border, color: p.muted }}>
            <span className="col-span-5">Lote</span>
            <span className="col-span-3">Compet\u00eancia</span>
            <span className="col-span-2 text-right">Valor</span>
            <span className="col-span-2 text-right">Status</span>
          </div>
          {[
            { name: "Empresas Prioridades Abril 2026", comp: "Abril/2026", val: "R$ 409.662,14", st: "Em revis\u00e3o", color: p.primary, soft: p.primarySoft, ic: Clock },
            { name: "Cirurgia Star Mar\u00e7o 2026", comp: "Mar\u00e7o/2026", val: "R$ 612.450,00", st: "Atrasado", color: p.destructive, soft: "#FEE2E2", ic: AlertTriangle },
            { name: "DF Parecer Insights Fev 2026", comp: "Fev/2026", val: "R$ 287.330,00", st: "Aprovado", color: p.success, soft: "#DCFCE7", ic: CheckCircle2 },
          ].map((r, i) => (
            <div key={i} className="px-4 py-2.5 border-b last:border-b-0 grid grid-cols-12 gap-2 text-xs items-center" style={{ borderColor: p.border }}>
              <span className="col-span-5 font-medium truncate" style={{ color: p.text }}>{r.name}</span>
              <span className="col-span-3" style={{ color: p.muted }}>{r.comp}</span>
              <span className="col-span-2 text-right font-bold tabular-nums" style={{ color: p.text }}>{r.val}</span>
              <span className="col-span-2 text-right">
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-medium" style={{ background: r.soft, color: r.color }}>
                  <r.ic className="h-3 w-3" /> {r.st}
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* Bot\u00f5es */}
        <div className="flex gap-2">
          <button className="text-xs px-3 py-1.5 rounded-md font-medium text-white" style={{ background: p.primary }}>
            Aprovar lote
          </button>
          <button className="text-xs px-3 py-1.5 rounded-md font-medium border" style={{ background: p.card, borderColor: p.borderStrong, color: p.text }}>
            Devolver
          </button>
          <button className="text-xs px-3 py-1.5 rounded-md font-medium" style={{ background: p.primarySoft, color: p.primary }}>
            Ver detalhes
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PreviewPalettes() {
  return (
    <div className="min-h-screen p-6" style={{ background: "#F1F5F9", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <div className="max-w-[1600px] mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold" style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif", color: "#0B1538" }}>
            Compara\u00e7\u00e3o de paletas
          </h1>
          <p className="text-sm mt-1" style={{ color: "#64748B" }}>
            Mesmo conte\u00fado renderizado com dois tons de fundo. Escolha qual aplicar globalmente.
          </p>
        </header>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <Mock p={SLATE_STEEL} />
          <Mock p={PURE_WHITE} />
        </div>
        <p className="text-xs mt-6 text-center" style={{ color: "#64748B" }}>
          Esta tela \u00e9 isolada \u2014 n\u00e3o usa o tema atual do sistema. Use s\u00f3 para comparar.
        </p>
      </div>
    </div>
  );
}

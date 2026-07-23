import { Wallet, Minus, Plus, Equal, Users, MinusCircle, Calculator, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FinancialComposition } from "@/hooks/useFinancialComposition";

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Faixa visual de composição financeira da empresa no lote.
 * Modo "analise" (default): mostra a equação completa
 *   Bruto − Débitos (+ Créditos) − Glosas − Pool = Líquido
 *   A conciliação NÃO aparece como parcela: ela age dentro do bruto.
 *
 * Modo "confeccao": ainda não há pagamento real. A faixa exibe o que o motor
 *   está calculando do zero: valor convênio → repasse calculado.
 *   Não aparecem débitos/glosas/pool/conciliação (são aplicados depois de
 *   finalizar a confecção e enviar para análise).
 */
export function FinancialCompositionStrip({
  comp,
  mode = "analise",
}: {
  comp: FinancialComposition;
  mode?: "analise" | "confeccao";
}) {
  if (comp.loading) return null;

  if (mode === "confeccao") {
    return (
      <div className="rounded-lg border-2 border-amber-500/30 bg-amber-500/5 shadow-soft px-4 py-3">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold">Repasse em confecção</h3>
          </div>
          <span className="text-[11px] text-muted-foreground">
            Motor está calculando o repasse a partir das regras cadastradas — ainda não há débitos/glosas/pool.
          </span>
        </div>

        <div className="flex flex-wrap items-stretch gap-2">
          <Cell label="Valor convênio" value={brl(comp.bruto)} tone="info" hint="Σ procedure_amount dos itens" />
          <Op icon={<ArrowRight className="h-3.5 w-3.5" />} />
          <Cell
            label="Repasse calculado"
            value={brl(comp.liquido)}
            tone="warning"
            highlight
            hint="Σ expected_amount (o que o motor irá pagar)"
          />
        </div>
      </div>
    );
  }

  const hasCredito = comp.creditos > 0;
  const hasDebito = comp.debitos > 0;
  const hasGlosa = comp.glosas > 0;
  const hasPool = (comp.poolAplicado || comp.poolPreview) && comp.pool !== 0;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-muted/30 rounded-lg border border-border/50">
      <Term label="Bruto" value={brl(comp.bruto)} />
      <FormulaOp>−</FormulaOp>
      <Term label="Débitos" value={hasDebito ? brl(comp.debitos) : "—"} muted={!hasDebito} />
      {hasCredito && (
        <>
          <FormulaOp>+</FormulaOp>
          <Term label="Créditos" value={brl(comp.creditos)} />
        </>
      )}
      <FormulaOp>−</FormulaOp>
      <Term label="Glosas" value={hasGlosa ? brl(comp.glosas) : "—"} muted={!hasGlosa} />
      <FormulaOp>−</FormulaOp>
      <Term label="Pool/Rateio" value={hasPool ? brl(comp.pool) : "—"} muted={!hasPool} />
      <FormulaOp>=</FormulaOp>
      <div className="flex flex-col items-center border-l-2 border-accent pl-3">
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Líquido a pagar</span>
        <span className="text-[14px] font-bold tabular-nums text-primary">{brl(comp.liquido)}</span>
      </div>
    </div>
  );
}

function Term({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("text-[13px] font-semibold tabular-nums", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function FormulaOp({ children }: { children: React.ReactNode }) {
  return <span className="text-[14px] font-medium text-muted-foreground">{children}</span>;
}

function Cell({
  label, value, tone = "muted", icon, hint, highlight, ratio,
}: {
  label: string; value: string;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  icon?: React.ReactNode; hint?: string; highlight?: boolean;
  /** Proporção 0–1 da parcela em relação ao bruto (mini-viz). */
  ratio?: number;
}) {
  // Bento Apple: card branco com radius 12, label discreta, valor proeminente,
  // mini-barra de proporção embaixo. O acento vive na barra e na label, não na borda.
  const tones: Record<string, { chip: string; bar: string }> = {
    muted: { chip: "text-muted-foreground", bar: "bg-muted-foreground/25" },
    info: { chip: "text-info", bar: "bg-info/60" },
    success: { chip: "text-success", bar: "bg-success/70" },
    warning: { chip: "text-warning-text", bar: "bg-amber-500/70" },
    destructive: { chip: "text-destructive", bar: "bg-destructive/70" },
  };
  const t = tones[tone];
  const pct = typeof ratio === "number" && isFinite(ratio)
    ? Math.max(0, Math.min(1, ratio))
    : null;
  return (
    <div className={cn(
      "flex-1 min-w-[120px] rounded-[12px] border border-border/40 bg-card shadow-card px-3 py-2",
      "flex flex-col justify-between",
      highlight && (tone === "warning"
        ? "ring-1 ring-amber-500/40 bg-amber-500/5"
        : "ring-1 ring-success/40 bg-success-soft/40"),
    )}>
      <div className={cn("flex items-center gap-1 text-[10px] uppercase tracking-[0.06em] font-semibold", t.chip)}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn(
        "mt-1 tabular-nums leading-tight font-semibold text-foreground",
        highlight ? "text-[15px]" : "text-[13.5px]",
      )}>{value}</div>
      {/* mini-viz: proporção em relação ao bruto */}
      {pct !== null && (
        <div className="mt-1.5 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-[width] duration-300", t.bar)}
            style={{ width: `${Math.max(2, pct * 100)}%` }}
          />
        </div>
      )}
      {hint && <div className="text-[10px] text-muted-foreground italic mt-1">{hint}</div>}
    </div>
  );
}

function Op({ icon }: { icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center text-muted-foreground self-stretch px-0.5">
      {icon}
    </div>
  );
}

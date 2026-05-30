import { Wallet, Minus, Plus, Equal, Users, GitCompareArrows, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FinancialComposition } from "@/hooks/useFinancialComposition";

const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Faixa visual de composição financeira da empresa no lote.
 * Mostra a equação: Bruto − Débitos (+ Créditos) − Glosas − Pool ± Conciliação = Líquido.
 * Itens não aplicados aparecem como "—" com tag discreta, mantendo a estrutura visível
 * para que o validador entenda o que foi/não foi considerado.
 */
export function FinancialCompositionStrip({ comp }: { comp: FinancialComposition }) {
  if (comp.loading) return null;

  const hasCredito = comp.creditos > 0;

  return (
    <div className="rounded-lg border bg-card shadow-soft px-4 py-3">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Composição financeira da empresa</h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          O grid abaixo mantém o bruto da produção. Esta faixa mostra o que efetivamente será pago.
        </span>
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        <Cell label="Bruto produção" value={brl(comp.bruto)} tone="info" />
        <Op icon={<Minus className="h-3.5 w-3.5" />} />
        <Cell label="Débitos" value={comp.debitos > 0 ? brl(comp.debitos) : "—"}
              tone={comp.debitos > 0 ? "destructive" : "muted"}
              hint={comp.debitos === 0 ? "Sem débitos" : undefined} />
        {hasCredito && (
          <>
            <Op icon={<Plus className="h-3.5 w-3.5" />} />
            <Cell label="Créditos" value={brl(comp.creditos)} tone="success" />
          </>
        )}
        <Op icon={<Minus className="h-3.5 w-3.5" />} />
        <Cell label="Glosas" value={comp.glosas > 0 ? brl(comp.glosas) : "—"}
              icon={<MinusCircle className="h-3.5 w-3.5" />}
              tone={comp.glosas > 0 ? "destructive" : "muted"}
              hint={comp.glosas === 0 ? "Sem glosas aplicadas" : undefined} />
        <Op icon={<Minus className="h-3.5 w-3.5" />} />
        <Cell label={comp.poolPreview && !comp.poolAplicado ? "Pool / rateio (prévia)" : "Pool / rateio"}
              value={(comp.poolAplicado || comp.poolPreview) && comp.pool !== 0 ? brl(comp.pool) : "—"}
              icon={<Users className="h-3.5 w-3.5" />}
              tone={comp.poolAplicado ? "warning" : comp.poolPreview ? "info" : "muted"}
              hint={(() => {
                if (!comp.poolAplicado && !comp.poolPreview) return "Sem pool aplicado";
                const dedTxt = comp.poolDetalhes
                  .flatMap(d => (d.deducoes ?? []).map(x => `${x.descricao || x.tipo} ${brl(x.valor)}`))
                  .join(" · ");
                const dedPrefix = dedTxt ? `Deduções: ${dedTxt} · ` : "";
                if (comp.poolPreview) {
                  return `Estimativa · ${dedPrefix}${comp.poolDetalhes.map(d => `${d.pool_nome} ${d.percentual}% → quota ${brl(d.quota_empresa)}`).join(" · ")}`;
                }
                if (comp.pool === 0) return `${dedPrefix}Pool sem impacto nesta empresa`;
                return `${dedPrefix}${comp.poolDetalhes.map(d => `${d.pool_nome}: quota ${brl(d.quota_empresa)}`).join(" · ")}`;
              })()} />

        <Op icon={
          <span className="inline-flex flex-col items-center leading-none text-[10px] font-semibold">
            <Plus className="h-3 w-3" />
            <Minus className="h-3 w-3 -mt-0.5" />
          </span>
        } />
        <Cell label="Conciliação"
              value={comp.conciliacaoAplicada && comp.conciliacao !== 0 ? brl(comp.conciliacao) : "—"}
              icon={<GitCompareArrows className="h-3.5 w-3.5" />}
              tone={comp.conciliacaoAplicada ? "info" : "muted"}
              hint={!comp.conciliacaoAplicada ? "Sem conciliação aplicada" : comp.conciliacao === 0 ? "Sem ajuste" : undefined} />
        <Op icon={<Equal className="h-3.5 w-3.5" />} />
        <Cell label="Líquido a pagar" value={brl(comp.liquido)} tone="success" highlight />
      </div>
    </div>
  );
}

function Cell({
  label, value, tone = "muted", icon, hint, highlight,
}: {
  label: string; value: string;
  tone?: "muted" | "info" | "success" | "warning" | "destructive";
  icon?: React.ReactNode; hint?: string; highlight?: boolean;
}) {
  const tones: Record<string, { ring: string; valueCls: string; chip: string }> = {
    muted: { ring: "border-border", valueCls: "text-muted-foreground", chip: "text-muted-foreground" },
    info: { ring: "border-info/30", valueCls: "text-foreground", chip: "text-info" },
    success: { ring: "border-success/30", valueCls: "text-foreground", chip: "text-success" },
    warning: { ring: "border-warning/30", valueCls: "text-foreground", chip: "text-warning-text" },
    destructive: { ring: "border-destructive/30", valueCls: "text-foreground", chip: "text-destructive" },
  };
  const t = tones[tone];
  return (
    <div className={cn(
      "flex-1 min-w-[120px] rounded-md border bg-background/60 px-2.5 py-1.5",
      t.ring,
      highlight && "bg-success-soft border-success/50 shadow-sm",
    )}>
      <div className={cn("flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium", t.chip)}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn(
        "mt-0.5 font-mono tabular-nums leading-tight",
        highlight ? "text-base font-bold text-success" : "text-sm font-semibold",
        t.valueCls,
      )}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground italic mt-0.5">{hint}</div>}
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

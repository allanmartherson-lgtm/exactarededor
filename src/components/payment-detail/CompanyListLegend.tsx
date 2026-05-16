import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Legenda compacta exibida acima da lista de empresas do lote.
 * Explica os ícones/cores usados nos cards (risco financeiro, validação
 * assistencial e contadores de status dos itens). Cada item tem tooltip.
 */
export const CompanyListLegend = () => {
  const dots: { color: string; label: string; tip: string }[] = [
    { color: "bg-red-500", label: "Crítico", tip: "Risco financeiro crítico (score ≥ 60) — atenção imediata." },
    { color: "bg-amber-500", label: "Alto", tip: "Risco financeiro alto (score 35–59) — priorizar revisão." },
    { color: "bg-yellow-500", label: "Médio", tip: "Risco financeiro médio (score 15–34)." },
    { color: "bg-green-500", label: "Baixo", tip: "Risco financeiro baixo (score < 15)." },
  ];
  return (
    <div className="text-[10px] text-muted-foreground flex flex-wrap items-center gap-3 py-2 px-1">
      {dots.map((d) => (
        <Tooltip key={d.label}>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 cursor-default">
              <span className={`w-2 h-2 rounded-full ${d.color}`} />
              {d.label}
            </span>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs">{d.tip}</p></TooltipContent>
        </Tooltip>
      ))}
      <span className="text-border">|</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 cursor-default">
            <span className="text-indigo-600">⊛</span> Alerta assistencial
          </span>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">Alertas de regras de validação assistencial disparadas.</p></TooltipContent>
      </Tooltip>
      <span className="text-border">|</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 cursor-default text-success">✓ Aprovado</span>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">Itens aprovados pelo motor.</p></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 cursor-default text-warning-foreground">⚠ Alerta</span>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">Itens com alerta — exigem revisão.</p></TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex items-center gap-1 cursor-default text-destructive">✕ Reprovado</span>
        </TooltipTrigger>
        <TooltipContent><p className="text-xs">Itens reprovados pelo motor.</p></TooltipContent>
      </Tooltip>
    </div>
  );
};

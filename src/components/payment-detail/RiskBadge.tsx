import { cn } from "@/lib/utils";
import {
  RISK_BADGE_CLASS,
  RISK_EMOJI,
  RISK_LABELS,
  type RiskLevel,
  type RiskFinancialData,
} from "@/lib/riskScore";
import { formatCurrency } from "@/lib/status";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";

const RISK_THRESHOLDS: Record<RiskLevel, string> = {
  baixo: "< 15",
  medio: "15–34",
  alto: "35–59",
  critico: "≥ 60",
};

const RISK_DESCRIPTION: Record<RiskLevel, string> = {
  baixo: "Impacto financeiro baixo ou nulo — pode seguir fluxo padrão.",
  medio: "Impacto moderado ou alertas sem reprovação significativa.",
  alto: "Problemas reais mas manejáveis — requer atenção.",
  critico: "Alto percentual de valor em risco e volume relevante — atenção imediata.",
};

/**
 * Badge de prioridade por risco. Apenas "Crítico" tem destaque forte;
 * demais níveis seguem o padrão visual suave (não competir com valor/status).
 *
 * Tooltip explica o que significa o nível e o score numérico, já que
 * "Alto · 80" sozinho não é autoexplicativo.
 */
export function RiskBadge({
  level,
  score,
  showLabel = true,
  className,
  title,
  reasons,
  financialData,
}: {
  level: RiskLevel;
  score?: number;
  showLabel?: boolean;
  className?: string;
  title?: string;
  reasons?: string[];
  financialData?: RiskFinancialData;
}) {
  const badge = (
    <div className="flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums whitespace-nowrap cursor-help",
          RISK_BADGE_CLASS[level],
          className,
        )}
      >
        <span aria-hidden>{RISK_EMOJI[level]}</span>
        {showLabel && <span>{RISK_LABELS[level]}</span>}
      {score != null && <span className="opacity-70">· {score}</span>}
      </span>
      <HelpCircle className="h-3 w-3 text-muted-foreground opacity-40 hover:opacity-100 transition-opacity cursor-help shrink-0" />
      {financialData && financialData.valorEmRisco > 0 && (
        <div className="text-[10px] text-muted-foreground whitespace-normal break-words opacity-80 mt-0.5 min-w-0">
          Valor em risco: <div className="font-semibold text-foreground inline-block"> {formatCurrency(financialData.valorEmRisco)}</div> <span className="whitespace-nowrap">({financialData.percentualRisco.toFixed(1)}% do total)</span>
        </div>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1.5">
            <p className="font-semibold text-xs">
              Risco {RISK_LABELS[level]}
              {score != null && <span className="font-normal opacity-80"> · score {score}</span>}
            </p>
            <p className="text-xs leading-snug opacity-90">{RISK_DESCRIPTION[level]}</p>
            <div className="text-[10px] opacity-80 leading-tight pt-1 border-t border-border/40">
              <div className="space-y-1 mb-2">
                <p className="font-semibold text-foreground">Fórmula do Score:</p>
                <p className="font-mono bg-muted/50 p-1 rounded">Score = (% Reprovado × 70) + (% Alerta × 30) + Bônus Volume</p>
                <p className="mt-1.5 opacity-90">
                  • <strong>% Valor:</strong> impacto financeiro real vs. faturamento PJ.<br/>
                  • <strong>Bônus Volume:</strong> peso adicional por volume total (máx +15).<br/>
                  • <strong>Critério:</strong> itens com exceção autorizada são ignorados.
                </p>
              </div>
              <p className="font-medium text-foreground">
                Faixas: Baixo {RISK_THRESHOLDS.baixo} · Médio {RISK_THRESHOLDS.medio} ·{" "}
                Alto {RISK_THRESHOLDS.alto} · Crítico {RISK_THRESHOLDS.critico}
              </p>
              {title && <p className="mt-1 italic">{title}</p>}
              {reasons && reasons.length > 0 && (
                <div className="mt-2 pt-1 border-t border-border/40">
                  <p className="font-semibold mb-1 text-[10px]">Detalhamento do Score:</p>
                  <ul className="space-y-0.5">
                    {reasons.map((r, i) => (
                      <li key={i} className="flex gap-1">
                        <span className="opacity-50">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

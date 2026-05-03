import { cn } from "@/lib/utils";
import {
  RISK_BADGE_CLASS,
  RISK_EMOJI,
  RISK_LABELS,
  type RiskLevel,
} from "@/lib/riskScore";

/**
 * Badge de prioridade por risco. Apenas "Crítico" tem destaque forte;
 * demais níveis seguem o padrão visual suave (não competir com valor/status).
 */
export function RiskBadge({
  level,
  score,
  showLabel = true,
  className,
  title,
}: {
  level: RiskLevel;
  score?: number;
  showLabel?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title ?? `Score ${score ?? "—"} — ${RISK_LABELS[level]}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] tabular-nums whitespace-nowrap",
        RISK_BADGE_CLASS[level],
        className,
      )}
    >
      <span aria-hidden>{RISK_EMOJI[level]}</span>
      {showLabel && <span>{RISK_LABELS[level]}</span>}
      {score != null && <span className="opacity-70">· {score}</span>}
    </span>
  );
}
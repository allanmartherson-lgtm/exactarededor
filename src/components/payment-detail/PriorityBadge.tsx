import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { PriorityScore } from "@/lib/paymentPriority";

const STYLES: Record<PriorityScore["level"], { label: string; emoji: string; cls: string }> = {
  urgente: {
    label: "Urgente",
    emoji: "🔴",
    cls: "bg-destructive/10 text-destructive border-destructive/30",
  },
  alta: {
    label: "Alta",
    emoji: "🟠",
    cls: "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
  },
  normal: { label: "Normal", emoji: "⚪", cls: "" },
  baixa: { label: "Baixa", emoji: "⚪", cls: "" },
};

export function PriorityBadge({ score, className }: { score: PriorityScore; className?: string }) {
  if (score.level === "normal" || score.level === "baixa") return null;
  const s = STYLES[score.level];

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium tabular-nums whitespace-nowrap cursor-help",
              s.cls,
              className,
            )}
          >
            <span aria-hidden>{s.emoji}</span>
            <span>{s.label}</span>
            <span className="opacity-70">· {score.score}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold text-xs">Prioridade {s.label} · score {score.score}</p>
            {score.reasons.length > 0 ? (
              <ul className="text-[10px] space-y-0.5">
                {score.reasons.map((r, i) => (
                  <li key={i} className="flex gap-1">
                    <span className="opacity-50">•</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] opacity-80">Sem fatores críticos.</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

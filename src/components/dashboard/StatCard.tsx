import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE_CLASSES } from "@/lib/status";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTruncated } from "@/hooks/use-truncated";

export type StatCardTone = "info" | "warning" | "success";

const toneBg: Record<StatCardTone, string> = {
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning-foreground",
  success: "bg-success-soft text-success",
};

export interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: StatCardTone;
  hint?: string;
  mine?: boolean;
  to?: string;
}

export const StatCard = ({ icon: Icon, label, value, tone, hint, mine, to }: StatCardProps) => {
  const interactive = !!to;
  const labelTruncation = useTruncated<HTMLParagraphElement>();
  const hintTruncation = useTruncated<HTMLParagraphElement>();

  // Rótulo único para tecnologias assistivas: une label + valor + status.
  const ariaLabel = [
    label,
    `valor ${value}`,
    mine ? "sua vez" : hint || undefined,
  ]
    .filter(Boolean)
    .join(", ");

  const inner = (
    <Card
      data-testid="stat-card"
      className={`shadow-soft transition h-full ${mine ? "ring-1 ring-primary/40" : ""} ${interactive ? "group-hover:shadow-card group-focus-visible:shadow-card" : ""}`}
    >
      <CardContent className="p-3 sm:p-4 lg:p-5 h-full flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <TruncatedText
            as="p"
            text={label}
            truncation={labelTruncation}
            data-testid="stat-card-label"
            className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-0 break-words leading-tight line-clamp-2 min-h-[2lh]"
          />
          <div
            aria-hidden="true"
            className={`h-8 w-8 sm:h-10 sm:w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${toneBg[tone]}`}
          >
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>

        <p
          data-testid="stat-card-value"
          className="text-2xl sm:text-3xl font-semibold tabular-nums leading-none"
        >
          {value}
        </p>

        <div data-testid="stat-card-footer" className="mt-auto flex items-center min-h-[20px]">
          {mine ? (
            <span
              data-testid="stat-card-badge"
              className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 leading-none ${TONE_CLASSES.info}`}
            >
              Sua vez
            </span>
          ) : hint ? (
            <TruncatedText
              as="p"
              text={hint}
              truncation={hintTruncation}
              data-testid="stat-card-hint"
              className="text-[11px] text-muted-foreground leading-tight line-clamp-1 min-w-0"
            />
          ) : (
            <span data-testid="stat-card-placeholder" className="text-[11px] text-transparent select-none" aria-hidden>
              &nbsp;
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
  if (interactive) {
    return (
      <Link
        to={to!}
        aria-label={ariaLabel}
        className="group block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-shadow"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div role="group" aria-label={ariaLabel} className="h-full">
      {inner}
    </div>
  );
};

export const StatCardSkeleton = () => (
  <Card
    data-testid="stat-card-skeleton"
    className="shadow-soft h-full"
    role="status"
    aria-label="Carregando indicador"
    aria-busy="true"
  >
    <CardContent className="p-3 sm:p-4 lg:p-5 h-full flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1 min-h-[2lh] justify-start">
          <Skeleton className="h-2.5 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg flex-shrink-0" />
      </div>
      <Skeleton className="h-7 sm:h-8 w-12" />
      <div className="mt-auto flex items-center min-h-[20px]">
        <Skeleton className="h-3 w-20" />
      </div>
    </CardContent>
  </Card>
);

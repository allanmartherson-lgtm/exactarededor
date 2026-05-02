import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TONE_CLASSES } from "@/lib/status";

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
  const inner = (
    <Card
      data-testid="stat-card"
      className={`shadow-soft transition h-full ${mine ? "ring-1 ring-primary/40" : ""} ${to ? "hover:shadow-card cursor-pointer" : ""}`}
    >
      <CardContent className="p-3 sm:p-4 lg:p-5 h-full flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <p
            data-testid="stat-card-label"
            className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-0 break-words leading-tight line-clamp-2 min-h-[2lh]"
            title={label}
          >
            {label}
          </p>
          <div className={`h-8 w-8 sm:h-10 sm:w-10 rounded-lg flex items-center justify-center flex-shrink-0 ${toneBg[tone]}`}>
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
            <p
              data-testid="stat-card-hint"
              className="text-[11px] text-muted-foreground leading-tight line-clamp-1"
              title={hint}
            >
              {hint}
            </p>
          ) : (
            <span data-testid="stat-card-placeholder" className="text-[11px] text-transparent select-none" aria-hidden>
              &nbsp;
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return to ? (
    <Link to={to} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
};

export const StatCardSkeleton = () => (
  <Card data-testid="stat-card-skeleton" className="shadow-soft h-full" aria-hidden>
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

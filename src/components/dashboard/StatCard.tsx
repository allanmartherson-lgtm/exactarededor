import { StatTile, StatTileSkeleton, type StatTileProps } from "@/components/ui/stat-tile";
import { TONE_CLASSES } from "@/lib/status";

export type StatCardTone = "info" | "warning" | "success";

const toneBg: Record<StatCardTone, string> = {
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning-foreground",
  success: "bg-success-soft text-success",
};

// Idle (zero-state, non-highlighted) icon styling — silenced grayscale so the
// active card naturally draws the eye. Apple-like: only what matters has color.
const idleBg = "bg-muted text-[hsl(var(--text-tertiary))]";

export interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone: StatCardTone;
  hint?: string;
  /** Quando verdadeiro, mostra o selo "Sua vez" no rodapé. */
  mine?: boolean;
  to?: string;
}

/**
 * StatCard — variante de domínio do StatTile usada no Dashboard.
 * Apple-like aesthetic: cards inativos (valor 0 e não destacados) usam o
 * ícone em tom muted para reduzir ruído visual; o destacado mantém a
 * cor de tom para guiar o olho.
 */
export const StatCard = ({ icon: Icon, label, value, tone, hint, mine, to }: StatCardProps) => {
  const isIdle = value === 0 && !mine;
  const iconNode = (
    <div
      className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl flex items-center justify-center ${
        isIdle ? idleBg : toneBg[tone]
      }`}
    >
      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
    </div>
  );

  // Pass the badge as a plain string so StatTile can render it as a floating
  // pill in the top-right corner of highlighted cards (Apple-like accent).
  const badge: StatTileProps["badge"] = mine ? "Sua vez" : undefined;

  return (
    <StatTile
      label={label}
      value={value}
      icon={iconNode}
      hint={hint}
      badge={badge}
      highlighted={mine}
      to={to}
      ariaLabel={[label, `valor ${value}`, mine ? "sua vez" : hint].filter(Boolean).join(", ")}
    />
  );
};

export const StatCardSkeleton = StatTileSkeleton;

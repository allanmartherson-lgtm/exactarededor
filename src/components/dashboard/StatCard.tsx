import { StatTile, StatTileSkeleton, type StatTileProps } from "@/components/ui/stat-tile";

export type StatCardTone = "info" | "warning" | "success";

// Bubble tokens já definidos em index.css (--bubble-*-bg / --bubble-*-fg).
const toneBubble: Record<StatCardTone, { bg: string; fg: string }> = {
  info: { bg: "hsl(var(--bubble-blue-bg))", fg: "hsl(var(--bubble-blue-fg))" },
  warning: { bg: "hsl(var(--bubble-yellow-bg))", fg: "hsl(var(--bubble-yellow-fg))" },
  success: { bg: "hsl(var(--bubble-green-bg))", fg: "hsl(var(--bubble-green-fg))" },
};

// Idle (zero-state, non-highlighted) icon styling — silenced grayscale so the
// active card naturally draws the eye. Apple-like: only what matters has color.
const idleBubble = {
  bg: "hsl(var(--muted))",
  fg: "hsl(var(--text-tertiary))",
};

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
 * Visual premium: bubble 32×32 com border-radius 8, número tabular 22px/600,
 * sem shadow grande, border 0.5px hairline (herdado do Card base).
 */
export const StatCard = ({ icon: Icon, label, value, tone, hint, mine, to }: StatCardProps) => {
  const isIdle = value === 0 && !mine;
  const colors = isIdle ? idleBubble : toneBubble[tone];
  const iconNode = (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: colors.bg,
        color: colors.fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon className="h-4 w-4" />
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

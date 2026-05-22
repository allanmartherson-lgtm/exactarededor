import { CSSProperties } from "react";
import { LucideIcon } from "lucide-react";

export type BubbleColor = "purple" | "yellow" | "teal" | "red" | "blue" | "green";

export const bubbleStyle = (color: BubbleColor): CSSProperties => ({
  background: `hsl(var(--bubble-${color}-bg))`,
  color: `hsl(var(--bubble-${color}-fg))`,
});

export const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center gap-3 mb-3">
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.07em",
        color: "hsl(var(--muted-foreground))",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
    <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
  </div>
);

export const SurfaceCard = ({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}) => (
  <div
    className={className}
    style={{
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 12,
      ...style,
    }}
  >
    {children}
  </div>
);

export const SurfaceCardHeader = ({
  title,
  icon: Icon,
  iconColor = "teal",
  countPill,
  rightAction,
  subtitle,
}: {
  title: string;
  icon?: LucideIcon;
  iconColor?: BubbleColor;
  countPill?: number;
  rightAction?: React.ReactNode;
  subtitle?: string;
}) => (
  <div
    className="flex items-center justify-between gap-3"
    style={{ padding: "18px 22px", borderBottom: "1px solid hsl(var(--border))" }}
  >
    <div className="flex items-center gap-2.5 min-w-0">
      {Icon && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...bubbleStyle(iconColor),
          }}
        >
          <Icon size={14} />
        </div>
      )}
      <div className="min-w-0">
        <h3
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "hsl(var(--foreground))",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {countPill !== undefined && countPill > 0 && (
        <span
          style={{
            background: "hsl(var(--destructive))",
            color: "hsl(var(--destructive-foreground))",
            borderRadius: 20,
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 8px",
            lineHeight: 1.4,
          }}
        >
          {countPill}
        </span>
      )}
    </div>
    {rightAction}
  </div>
);

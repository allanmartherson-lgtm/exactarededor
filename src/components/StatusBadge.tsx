import { cn } from "@/lib/utils";
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES, type PaymentStatus } from "@/lib/status";

interface StatusBadgeProps {
  status: PaymentStatus;
  className?: string;
}

type Tone = "info" | "success" | "warning" | "destructive" | "muted" | "primary";

const TONE_TOKENS: Record<Tone, { bg: string; text: string; dot: string }> = {
  success: {
    bg: "hsl(var(--success-soft))",
    text: "hsl(var(--success-text))",
    dot: "hsl(var(--success))",
  },
  warning: {
    bg: "hsl(var(--warning-soft))",
    text: "hsl(var(--warning-text))",
    dot: "hsl(var(--warning))",
  },
  info: {
    bg: "hsl(var(--info-soft))",
    text: "hsl(var(--info-text))",
    dot: "hsl(var(--info))",
  },
  destructive: {
    bg: "hsl(var(--destructive-soft))",
    text: "hsl(var(--destructive-text))",
    dot: "hsl(var(--destructive))",
  },
  primary: {
    bg: "hsl(var(--primary-soft))",
    text: "hsl(var(--primary))",
    dot: "hsl(var(--primary))",
  },
  muted: {
    bg: "hsl(var(--muted))",
    text: "hsl(var(--muted-foreground))",
    dot: "hsl(var(--muted-foreground))",
  },
};

export const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  const tone = (PAYMENT_STATUS_TONES[status] ?? "muted") as Tone;
  const tokens = TONE_TOKENS[tone];
  return (
    <span
      className={cn("inline-flex items-center", className)}
      style={{
        gap: 5,
        padding: "2px 8px",
        borderRadius: 9999,
        background: tokens.bg,
        color: tokens.text,
        fontSize: 10.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        lineHeight: 1.6,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: tokens.dot,
          flexShrink: 0,
          display: "inline-block",
        }}
      />
      {PAYMENT_STATUS_LABELS[status]}
    </span>
  );
};

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badge — padrão único de chip/pill/indicador de status.
 *
 * Visual premium: pill (rounded-full), sem border, padding 2px 8px,
 * font-size 10.5px / weight 500. Variantes de status usam pares
 * `--*-soft` (fundo) + `--*-text` (texto) para manter contraste em
 * light/dark sem hardcode.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border-0 px-2 py-[2px] text-[10.5px] font-medium leading-[1.6] tracking-tight tabular-nums whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        secondary: "bg-muted text-muted-foreground",
        destructive:
          "bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive-text))]",
        outline: "border border-border text-foreground bg-transparent",
        success:
          "bg-[hsl(var(--success-soft))] text-[hsl(var(--success-text))]",
        warning:
          "bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning-text))]",
        info:
          "bg-[hsl(var(--info-soft))] text-[hsl(var(--info-text))]",
        "soft-blue":
          "bg-[hsl(211_100%_94%)] text-[hsl(211_100%_40%)] dark:bg-[hsl(211_40%_18%)] dark:text-[hsl(211_90%_78%)]",
        muted: "bg-muted text-muted-foreground",
        primary:
          "bg-primary text-primary-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

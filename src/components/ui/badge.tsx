import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badge — padrão único de chip/pill/indicador de status.
 *
 * Regras (mantidas em todos os temas):
 *  - `rounded-full` (formato pill consistente)
 *  - sombra suave `shadow-[var(--shadow-soft)]`
 *  - tipografia tabular para números, peso médio
 *  - variantes de status usam tokens `-soft` (fundo) + cor da família
 *    correspondente (texto), garantindo legibilidade em light/dark
 *    sem hardcode de cores.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-none tracking-tight tabular-nums whitespace-nowrap shadow-[var(--shadow-soft)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-[hsl(var(--destructive-soft))] text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive-soft))]/80",
        outline: "border-border text-foreground bg-background",
        success:
          "border-transparent bg-[hsl(var(--success-soft))] text-[hsl(var(--success))] hover:bg-[hsl(var(--success-soft))]/80",
        warning:
          "border-transparent bg-[hsl(var(--warning-soft))] text-[hsl(var(--warning))] hover:bg-[hsl(var(--warning-soft))]/80",
        info:
          "border-transparent bg-[hsl(var(--info-soft))] text-[hsl(var(--info))] hover:bg-[hsl(var(--info-soft))]/80",
        muted:
          "border-transparent bg-muted text-muted-foreground hover:bg-muted/80",
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

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[6px] whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // CURA: primary sólido navy #003DA5, sem sombra pesada, corners 4px.
        default: "bg-primary text-primary-foreground font-medium hover:bg-primary/90 active:bg-primary/80 border-none",
        // CURA: destrutivo outlined (usado em ações reversíveis).
        destructive: "border-[1.5px] border-destructive bg-transparent text-destructive hover:bg-destructive/10 active:bg-destructive/15",
        // CURA secundário: outline neutro.
        outline: "border border-border bg-transparent text-foreground hover:bg-muted hover:border-border-strong active:bg-muted/80",
        secondary: "border border-border bg-transparent text-foreground hover:bg-muted hover:border-border-strong active:bg-muted/80",
        ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted p-0 h-auto",
        link: "text-primary underline-offset-4 hover:underline focus-visible:underline",
        // Copper: agora remapeado ao accent laranja CURA #FF8200.
        copper: "bg-copper text-copper-foreground border-none hover:bg-copper-hover active:bg-copper-active disabled:bg-copper/55 disabled:text-copper-foreground/80 disabled:shadow-none disabled:opacity-100 disabled:cursor-not-allowed",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-[12.5px]",
        lg: "h-11 px-8",
        // Ícones permanecem circulares (avatares, close, etc — não são CTAs CURA).
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[6px] whitespace-nowrap rounded-xl text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[hsl(var(--ring-soft))] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground font-medium hover:bg-primary/90 active:bg-primary/80 border-none shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-card)]",
        destructive: "border-[1.5px] border-destructive bg-transparent text-destructive hover:bg-destructive/10 active:bg-destructive/15",
        outline: "border-[1.5px] border-primary bg-transparent text-primary hover:bg-primary/10 active:bg-primary/15",
        secondary: "border-[1.5px] border-primary bg-transparent text-primary hover:bg-primary/10 active:bg-primary/15",
        ghost: "bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted p-0 h-auto",
        link: "text-primary underline-offset-4 hover:underline focus-visible:underline",
        copper: "bg-copper text-copper-foreground border-none shadow-[var(--shadow-soft)] hover:bg-copper-hover hover:shadow-[var(--shadow-card)] active:bg-copper-active disabled:bg-copper/55 disabled:text-copper-foreground/80 disabled:shadow-none disabled:opacity-100 disabled:cursor-not-allowed",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3",
        lg: "h-11 rounded-xl px-8",
        icon: "h-10 w-10",
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

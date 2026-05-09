import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-[6px] whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#2563EB] text-white font-medium hover:bg-[#1D4ED8] active:bg-[#1E40AF] border-none shadow-sm",
        destructive: "border-[1.5px] border-[#DC2626] bg-transparent text-[#DC2626] hover:bg-[#DC2626]/08 active:bg-[#DC2626]/10",
        outline: "border-[1.5px] border-[#2563EB] bg-transparent text-[#2563EB] hover:bg-[#2563EB]/08 active:bg-[#2563EB]/10",
        secondary: "border-[1.5px] border-[#2563EB] bg-transparent text-[#2563EB] hover:bg-[#2563EB]/08 active:bg-[#2563EB]/10",
        ghost: "bg-transparent text-[#6B7280] hover:text-[#374151] hover:bg-transparent p-0 h-auto",
        link: "text-[#2563EB] underline-offset-4 hover:underline focus-visible:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
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

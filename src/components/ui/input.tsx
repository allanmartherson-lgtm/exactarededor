import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-[12px] border border-border-strong bg-input-bg px-3 py-2 text-base text-foreground shadow-[var(--shadow-inset)] transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-foreground/40 focus-visible:outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-[hsl(var(--ring-soft))] disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-muted md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };

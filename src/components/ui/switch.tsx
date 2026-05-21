import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      "peer relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border-strong shadow-[var(--shadow-inset)] transition-colors data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=unchecked]:bg-track-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        "pointer-events-none block h-[18px] w-[18px] rounded-full bg-white border border-black/10 shadow-[0_1px_2px_rgba(0,0,0,0.15),0_2px_4px_rgba(0,0,0,0.1)] ring-0 transition-transform data-[state=checked]:translate-x-[22px] data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };

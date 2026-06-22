import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * SegmentedControl — Apple iOS / macOS style.
 *
 * Trilho cinza claro (#e8e8ed-ish via muted), item ativo branco com sombra
 * sutil, altura compacta (~32px), radius 8px interno / 9px externo.
 *
 * API enxuta para servir como drop-in em tabs simples (apenas seleção, sem
 * conteúdo associado). Para tabs com TabsContent, use shadcn Tabs.
 */
export type SegmentedControlOption<T extends string = string> = {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
};

interface SegmentedControlProps<T extends string = string>
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  size?: "sm" | "md";
  ariaLabel?: string;
}

export function SegmentedControl<T extends string = string>({
  value,
  onValueChange,
  options,
  size = "md",
  ariaLabel,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const heights = size === "sm" ? "h-7 text-[12px]" : "h-8 text-[13px]";
  const innerPad = size === "sm" ? "px-2.5" : "px-3";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[9px] bg-muted p-0.5",
        "border border-border/40",
        className,
      )}
      {...rest}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={opt.disabled}
            onClick={() => !opt.disabled && onValueChange(opt.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-[7px] font-medium",
              "transition-all duration-150 select-none whitespace-nowrap",
              heights,
              innerPad,
              active
                ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)]"
                : "text-muted-foreground hover:text-foreground",
              opt.disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

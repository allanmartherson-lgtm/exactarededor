import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Conteúdo extra abaixo do valor (chips, dots, sparkline etc.). */
  extra?: ReactNode;
  /** Variante de cor. `primary` destaca o card com fundo cheio. */
  tone?: Tone;
  className?: string;
}

/**
 * KpiCard — padrão visual unificado (Padrão BI).
 *
 * Cantos arredondados (rounded-2xl), label uppercase tracking-wider,
 * valor grande tabular-nums, sem ícones coloridos para manter a estética
 * limpa das telas de BI. Variante `primary` para o card de destaque.
 */
export const KpiCard = ({
  label,
  value,
  hint,
  extra,
  tone = "default",
  className,
}: KpiCardProps) => {
  const isPrimary = tone === "primary";
  const valueToneClass = !isPrimary
    ? {
        default: "text-foreground",
        success: "text-success",
        warning: "text-warning",
        danger: "text-destructive",
        info: "text-info",
        primary: "",
      }[tone]
    : "";

  return (
    <div
      className={cn(
        "rounded-2xl border p-6 transition-colors",
        isPrimary
          ? "border-transparent bg-primary text-primary-foreground"
          : "bg-card border-border/60",
        className,
      )}
    >
      <div
        className={cn(
          "text-[11px] font-semibold uppercase tracking-[0.12em]",
          isPrimary ? "text-primary-foreground/75" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-3 text-3xl font-semibold tracking-tight tabular-nums leading-none",
          isPrimary ? "text-primary-foreground" : valueToneClass,
        )}
      >
        {value}
      </div>
      {extra && <div className="mt-3">{extra}</div>}
      {hint && (
        <div
          className={cn(
            "text-xs mt-3",
            isPrimary ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
};

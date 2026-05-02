import * as React from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTruncated } from "@/hooks/use-truncated";
import { cn } from "@/lib/utils";

/**
 * StatTile — bloco de KPI/indicador padronizado para todo o app.
 *
 * Garante (e protegido por testes em src/components/dashboard/__tests__):
 *  - altura uniforme em grids (`h-full` no Card e CardContent)
 *  - hierarquia constante: label (até 2 linhas) → valor → footer (badge OU hint OU placeholder)
 *  - tooltip automático quando label/hint forem truncados
 *  - aria-label agregado quando o tile vira link
 *  - foco visível consistente (mesmo anel do resto da UI)
 *
 * Use em vez de criar um novo Card de KPI à mão.
 */
export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** Slot opcional no canto superior direito (ícone com cor de tom). */
  icon?: React.ReactNode;
  /** Texto curto exibido no rodapé (ex.: "2 no time"). Truncado em 1 linha. */
  hint?: string;
  /** Selo prioritário no rodapé (ex.: "Sua vez"). Substitui o hint quando presente. */
  badge?: React.ReactNode;
  /** Destaca o tile com anel da cor primária (ex.: pertence ao usuário). */
  highlighted?: boolean;
  /** Se passado, transforma o tile inteiro num link navegável. */
  to?: string;
  /** aria-label custom; quando ausente é gerado a partir de label + valor + badge/hint. */
  ariaLabel?: string;
  className?: string;
  /**
   * Densidade visual. `default` é o KPI padrão; `compact` reduz padding,
   * tamanho do ícone, do valor e do label — usado em grids densos como o
   * pipeline (até 7 colunas). Mantém a MESMA hierarquia e tokens.
   */
  density?: "default" | "compact";
  /**
   * Tooltip rico opcional (ReactNode) exibido ao passar o mouse / focar o
   * tile inteiro. Quando fornecido, substitui o tooltip automático de
   * truncamento do label/hint.
   */
  tooltip?: React.ReactNode;
}

const TruncatedText = ({
  as: Tag = "p",
  text,
  truncation,
  className,
  ...rest
}: {
  as?: "p" | "span";
  text: string;
  truncation: ReturnType<typeof useTruncated<HTMLParagraphElement>>;
  className?: string;
} & React.HTMLAttributes<HTMLElement>) => {
  if (!truncation.isTruncated) {
    return (
      <Tag ref={truncation.ref as never} className={className} {...rest}>
        {text}
      </Tag>
    );
  }
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Tag
          ref={truncation.ref as never}
          tabIndex={0}
          aria-label={text}
          className={cn(
            className,
            "cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm",
          )}
          {...rest}
        >
          {text}
        </Tag>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
};

export const StatTile = ({
  label,
  value,
  icon,
  hint,
  badge,
  highlighted,
  to,
  ariaLabel,
  className,
  density = "default",
  tooltip,
}: StatTileProps) => {
  const interactive = !!to;
  const labelTruncation = useTruncated<HTMLParagraphElement>();
  const hintTruncation = useTruncated<HTMLParagraphElement>();
  const isCompact = density === "compact";

  const computedAriaLabel =
    ariaLabel ??
    [
      label,
      typeof value === "string" || typeof value === "number" ? `valor ${value}` : null,
      typeof badge === "string" ? badge : badge ? "destacado" : hint || null,
    ]
      .filter(Boolean)
      .join(", ");

  const inner = (
    <Card
      data-testid="stat-card"
      className={cn(
        "shadow-soft transition h-full",
        highlighted && "ring-1 ring-primary/40",
        interactive && "group-hover:shadow-card group-focus-visible:shadow-card",
        className,
      )}
    >
      <CardContent
        className={cn(
          "h-full flex flex-col",
          isCompact ? "p-3 gap-2" : "p-3 sm:p-4 lg:p-5 gap-3",
        )}
      >
        <div className={cn("flex items-start justify-between", isCompact ? "gap-2" : "gap-2 sm:gap-3")}>
          <TruncatedText
            as="p"
            text={label}
            truncation={tooltip ? { ref: labelTruncation.ref, isTruncated: false } : labelTruncation}
            data-testid="stat-card-label"
            className={cn(
              "font-medium text-muted-foreground uppercase tracking-wider min-w-0 break-words leading-tight line-clamp-2 min-h-[2lh]",
              isCompact ? "text-[10px]" : "text-[10px] sm:text-xs",
            )}
          />
          {icon && (
            <div aria-hidden="true" className="flex-shrink-0">
              {icon}
            </div>
          )}
        </div>

        <p
          data-testid="stat-card-value"
          className={cn(
            isCompact ? "text-2xl" : "text-2xl sm:text-3xl",
            "font-semibold tabular-nums leading-none",
          )}
        >
          {value}
        </p>

        <div data-testid="stat-card-footer" className="mt-auto flex items-center min-h-[20px]">
          {badge ? (
            <span data-testid="stat-card-badge">{badge}</span>
          ) : hint ? (
            <TruncatedText
              as="p"
              text={hint}
              truncation={tooltip ? { ref: hintTruncation.ref, isTruncated: false } : hintTruncation}
              data-testid="stat-card-hint"
              className="text-[11px] text-muted-foreground leading-tight line-clamp-1 min-w-0"
            />
          ) : (
            <span
              data-testid="stat-card-placeholder"
              className="text-[11px] text-transparent select-none"
              aria-hidden
            >
              &nbsp;
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );

  // Wrapper opcional de tooltip rico — envolve o tile inteiro.
  const wrapWithTooltip = (node: React.ReactNode) =>
    tooltip ? (
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>{node as React.ReactElement}</TooltipTrigger>
        <TooltipContent side="top" align="center" className="max-w-xs text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    ) : (
      node
    );

  if (interactive) {
    return wrapWithTooltip(
      <Link
        to={to!}
        aria-label={computedAriaLabel}
        className="group block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-shadow"
      >
        {inner}
      </Link>,
    );
  }

  return wrapWithTooltip(
    <div role="group" aria-label={computedAriaLabel} className="h-full">
      {inner}
    </div>,
  );
};

export const StatTileSkeleton = ({ density = "default" }: { density?: "default" | "compact" } = {}) => {
  const isCompact = density === "compact";
  return (
  <Card
    data-testid="stat-card-skeleton"
    className="shadow-soft h-full"
    role="status"
    aria-label="Carregando indicador"
    aria-busy="true"
  >
    <CardContent
      className={cn(
        "h-full flex flex-col",
        isCompact ? "p-3 gap-2" : "p-3 sm:p-4 lg:p-5 gap-3",
      )}
    >
      <div className={cn("flex items-start justify-between", isCompact ? "gap-2" : "gap-2 sm:gap-3")}>
        <div className="flex flex-col gap-1.5 min-w-0 flex-1 min-h-[2lh] justify-start">
          <Skeleton className="h-2.5 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton
          className={cn(
            "rounded-lg flex-shrink-0",
            isCompact ? "h-7 w-7" : "h-8 w-8 sm:h-10 sm:w-10",
          )}
        />
      </div>
      <Skeleton className={cn("w-12", isCompact ? "h-7" : "h-7 sm:h-8")} />
      <div className="mt-auto flex items-center min-h-[20px]">
        <Skeleton className="h-3 w-20" />
      </div>
    </CardContent>
  </Card>
  );
};

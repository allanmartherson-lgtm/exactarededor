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
}: StatTileProps) => {
  const interactive = !!to;
  const labelTruncation = useTruncated<HTMLParagraphElement>();
  const hintTruncation = useTruncated<HTMLParagraphElement>();

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
      <CardContent className="p-3 sm:p-4 lg:p-5 h-full flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <TruncatedText
            as="p"
            text={label}
            truncation={labelTruncation}
            data-testid="stat-card-label"
            className="text-[10px] sm:text-xs font-medium text-muted-foreground uppercase tracking-wider min-w-0 break-words leading-tight line-clamp-2 min-h-[2lh]"
          />
          {icon && (
            <div aria-hidden="true" className="flex-shrink-0">
              {icon}
            </div>
          )}
        </div>

        <p
          data-testid="stat-card-value"
          className="text-2xl sm:text-3xl font-semibold tabular-nums leading-none"
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
              truncation={hintTruncation}
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

  if (interactive) {
    return (
      <Link
        to={to!}
        aria-label={computedAriaLabel}
        className="group block h-full rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-shadow"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div role="group" aria-label={computedAriaLabel} className="h-full">
      {inner}
    </div>
  );
};

export const StatTileSkeleton = () => (
  <Card
    data-testid="stat-card-skeleton"
    className="shadow-soft h-full"
    role="status"
    aria-label="Carregando indicador"
    aria-busy="true"
  >
    <CardContent className="p-3 sm:p-4 lg:p-5 h-full flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2 sm:gap-3">
        <div className="flex flex-col gap-1.5 min-w-0 flex-1 min-h-[2lh] justify-start">
          <Skeleton className="h-2.5 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton className="h-8 w-8 sm:h-10 sm:w-10 rounded-lg flex-shrink-0" />
      </div>
      <Skeleton className="h-7 sm:h-8 w-12" />
      <div className="mt-auto flex items-center min-h-[20px]">
        <Skeleton className="h-3 w-20" />
      </div>
    </CardContent>
  </Card>
);

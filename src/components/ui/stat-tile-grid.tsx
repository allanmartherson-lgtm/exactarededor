import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Grid padrão para StatTile/StatCard. Mantém altura uniforme entre
 * todos os tiles (auto-rows-fr) e responsividade (2 colunas no mobile,
 * 4 no desktop). Coberto por testes de invariantes.
 */
export const StatTileGrid = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    data-testid="stat-cards-grid"
    className={cn(
      "grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-stretch auto-rows-fr",
      className,
    )}
  >
    {children}
  </div>
);

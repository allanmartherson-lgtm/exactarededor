import * as React from "react";

/**
 * Grid responsável por manter os StatCards com altura uniforme.
 * As classes `grid-cols-2 lg:grid-cols-4`, `items-stretch` e `auto-rows-fr`
 * são invariantes do design — a remoção de qualquer uma delas pode causar
 * cards de alturas diferentes. Existem testes que travam isso.
 */
export const StatCardsGrid = ({ children }: { children: React.ReactNode }) => (
  <div
    data-testid="stat-cards-grid"
    className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 items-stretch auto-rows-fr"
  >
    {children}
  </div>
);

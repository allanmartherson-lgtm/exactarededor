// Helpers para apresentar valor líquido como número principal,
// mostrando o bruto como subline apenas quando há diferença material.
const brl = (n: number) =>
  Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function formatLiquido(liquido: number | string | null | undefined): string {
  return brl(Number(liquido ?? 0));
}

/** Mostra "R$ líquido" sempre. Quando bruto difere em > 1 centavo, retorna também o sub. */
export function liquidoComBruto(
  liquido: number | string | null | undefined,
  bruto: number | string | null | undefined,
): { main: string; sub: string | null; diverge: boolean } {
  const l = Number(liquido ?? 0);
  const b = Number(bruto ?? 0);
  const diverge = Math.abs(l - b) > 0.01;
  return {
    main: brl(l),
    sub: diverge ? `Bruto ${brl(b)}` : null,
    diverge,
  };
}

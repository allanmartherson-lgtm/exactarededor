/**
 * Mirror puro em TypeScript da view `public.vw_group_rule_totals`.
 *
 * Fonte de verdade: supabase/migrations/20260712215344_*.sql
 *
 * Regra crítica: itens marcados com `package_absorbed = true` tiveram seu
 * valor movido para o item âncora do pacote/regra fixa. O `gross_amount`
 * permanece nos absorvidos porque veio assim do relatório do hospital, mas
 * o `expected_amount` é 0. Se somarmos o gross de todos os itens contra o
 * expected total, criamos uma diferença fantasma exatamente igual ao gross
 * dos absorvidos — foi o bug que bloqueou GMG/SALUTAIRE em 12/07/2026.
 *
 * Por isso a fórmula desconta o `absorbido_total` do lado do pedido antes
 * de comparar com o `bruto_regra_total`.
 */

export type GroupItemForTotals = {
  gross_amount: number | null;
  expected_amount: number | null;
  applied_calc_id: string | null;
  package_absorbed: boolean | null;
};

export type GroupRuleTotals = {
  bruto_pedido_total: number;
  bruto_regra_total: number;
  absorbido_total: number;
  diferenca: number;
  diferenca_pct: number | null;
  itens_sem_regra: number;
  itens_divergentes: number;
  itens_total: number;
};

export function computeGroupRuleTotals(
  brutoPedidoTotal: number,
  items: GroupItemForTotals[],
): GroupRuleTotals {
  let bruto_regra_total = 0;
  let absorbido_total = 0;
  let itens_sem_regra = 0;
  let itens_divergentes = 0;

  for (const it of items) {
    const absorbed = it.package_absorbed === true;
    const gross = Number(it.gross_amount ?? 0);
    const expected = Number(it.expected_amount ?? 0);

    bruto_regra_total += expected;
    if (absorbed) absorbido_total += gross;

    if (!absorbed && it.applied_calc_id == null) itens_sem_regra += 1;

    if (
      !absorbed &&
      it.expected_amount != null &&
      it.gross_amount != null &&
      Math.abs(expected - gross) > 0.01
    ) {
      itens_divergentes += 1;
    }
  }

  const diferenca = brutoPedidoTotal - absorbido_total - bruto_regra_total;
  const diferenca_pct =
    brutoPedidoTotal === 0 ? null : (diferenca / brutoPedidoTotal) * 100;

  return {
    bruto_pedido_total: brutoPedidoTotal,
    bruto_regra_total,
    absorbido_total,
    diferenca,
    diferenca_pct,
    itens_sem_regra,
    itens_divergentes,
    itens_total: items.length,
  };
}

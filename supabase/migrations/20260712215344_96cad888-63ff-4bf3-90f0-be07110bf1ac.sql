DROP VIEW IF EXISTS public.vw_group_rule_totals;

CREATE VIEW public.vw_group_rule_totals AS
SELECT
  g.id AS group_id,
  g.payment_id,
  g.company_id,
  g.hospital_id,
  g.status,
  g.bruto_total AS bruto_pedido_total,
  COALESCE(SUM(pi.expected_amount), 0) AS bruto_regra_total,
  COALESCE(SUM(CASE WHEN pi.package_absorbed THEN pi.gross_amount ELSE 0 END), 0) AS absorbido_total,
  (g.bruto_total
    - COALESCE(SUM(CASE WHEN pi.package_absorbed THEN pi.gross_amount ELSE 0 END), 0)
    - COALESCE(SUM(pi.expected_amount), 0)
  ) AS diferenca,
  CASE
    WHEN COALESCE(g.bruto_total, 0) = 0 THEN NULL
    ELSE (
      g.bruto_total
      - COALESCE(SUM(CASE WHEN pi.package_absorbed THEN pi.gross_amount ELSE 0 END), 0)
      - COALESCE(SUM(pi.expected_amount), 0)
    ) / g.bruto_total * 100
  END AS diferenca_pct,
  COUNT(*) FILTER (WHERE pi.applied_calc_id IS NULL AND NOT COALESCE(pi.package_absorbed, false)) AS itens_sem_regra,
  COUNT(*) FILTER (
    WHERE pi.expected_amount IS NOT NULL
      AND pi.gross_amount IS NOT NULL
      AND NOT COALESCE(pi.package_absorbed, false)
      AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) > 0.01
  ) AS itens_divergentes,
  COUNT(pi.id) AS itens_total
FROM public.payment_company_groups g
LEFT JOIN public.payment_items pi
  ON pi.payment_id = g.payment_id
 AND pi.company_id = g.company_id
GROUP BY g.id;

GRANT SELECT ON public.vw_group_rule_totals TO authenticated, service_role;
CREATE OR REPLACE VIEW public.v_payment_production_period AS
SELECT
  pi.payment_id,
  MIN(pi.item_competence) AS production_period_start,
  MAX(pi.item_competence) AS production_period_end,
  array_agg(DISTINCT pi.item_competence ORDER BY pi.item_competence) AS production_months,
  count(*) FILTER (WHERE pi.competence_source = 'payment_month') AS itens_sem_producao_real
FROM public.payment_items pi
GROUP BY pi.payment_id;

GRANT SELECT ON public.v_payment_production_period TO authenticated;
GRANT SELECT ON public.v_payment_production_period TO service_role;
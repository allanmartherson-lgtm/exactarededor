
-- Recria hide_test_rows_select como RESTRICTIVE (a versão anterior era permissive → não filtrava nada).
DROP POLICY IF EXISTS hide_test_rows_select ON public.payments;
CREATE POLICY hide_test_rows_select ON public.payments
  AS RESTRICTIVE FOR SELECT TO authenticated, anon
  USING (is_test IS NOT TRUE);

DROP POLICY IF EXISTS hide_test_rows_select ON public.payment_company_groups;
CREATE POLICY hide_test_rows_select ON public.payment_company_groups
  AS RESTRICTIVE FOR SELECT TO authenticated, anon
  USING (is_test IS NOT TRUE);

-- Limpa os órfãos de teste que já vazaram para a UI.
DELETE FROM public.payment_observations
 WHERE payment_id IN (SELECT id FROM public.payments WHERE is_test = true);
DELETE FROM public.payment_company_groups WHERE is_test = true;
DELETE FROM public.payments WHERE is_test = true;

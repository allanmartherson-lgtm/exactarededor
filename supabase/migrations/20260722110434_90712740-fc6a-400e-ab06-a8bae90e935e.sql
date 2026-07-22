
-- 1) payments/payment_company_groups: remove anon from RESTRICTIVE policy
DROP POLICY IF EXISTS hide_test_rows_select ON public.payments;
CREATE POLICY hide_test_rows_select ON public.payments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (COALESCE(is_test, false) = false OR public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS hide_test_rows_select ON public.payment_company_groups;
CREATE POLICY hide_test_rows_select ON public.payment_company_groups
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (COALESCE(is_test, false) = false OR public.has_role(auth.uid(), 'admin'::app_role));

-- 2) payout_models: restrict SELECT to internal staff roles (drop broad true policy)
DROP POLICY IF EXISTS "payout_models read" ON public.payout_models;
CREATE POLICY "payout_models read internal" ON public.payout_models
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
  );

-- 3) system_parameter_defs / overrides: restrict SELECT to internal staff roles
DROP POLICY IF EXISTS "params_defs_read_auth" ON public.system_parameter_defs;
CREATE POLICY "params_defs_read_internal" ON public.system_parameter_defs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
  );

DROP POLICY IF EXISTS "params_overrides_read_auth" ON public.system_parameter_overrides;
CREATE POLICY "params_overrides_read_internal" ON public.system_parameter_overrides
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
  );

-- 4) storage: tighten payment-files upload — require internal staff role AND own-folder prefix
DROP POLICY IF EXISTS "payment-files: upload pelo dono" ON storage.objects;
CREATE POLICY "payment-files: upload pelo staff interno"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-files'
    AND split_part(name, '/', 1) = auth.uid()::text
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'diretor'::app_role)
      OR public.has_role(auth.uid(), 'validador'::app_role)
      OR public.has_role(auth.uid(), 'analista'::app_role)
      OR public.has_role(auth.uid(), 'gestao_medica'::app_role)
    )
  );

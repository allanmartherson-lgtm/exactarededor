-- payments
DROP POLICY IF EXISTS payments_view_authenticated ON public.payments;
CREATE POLICY payments_view_workflow
ON public.payments FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- payment_company_groups
DROP POLICY IF EXISTS pcg_view_authenticated ON public.payment_company_groups;
CREATE POLICY pcg_view_workflow
ON public.payment_company_groups FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- payment_observations
DROP POLICY IF EXISTS obs_view_authenticated ON public.payment_observations;
CREATE POLICY obs_view_workflow
ON public.payment_observations FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- ai_analysis_versions
DROP POLICY IF EXISTS ai_versions_view_authenticated ON public.ai_analysis_versions;
CREATE POLICY ai_versions_view_workflow
ON public.ai_analysis_versions FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- cost_center_imports — admin/diretor only
DROP POLICY IF EXISTS cc_imports_view_authenticated ON public.cost_center_imports;
CREATE POLICY cc_imports_view_admin_diretor
ON public.cost_center_imports FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
);

-- audit_log: INSERT exige role válida + auth.uid() = actor_id
DROP POLICY IF EXISTS audit_log_insert_self ON public.audit_log;
CREATE POLICY audit_log_insert_workflow
ON public.audit_log FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = actor_id
  AND (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);

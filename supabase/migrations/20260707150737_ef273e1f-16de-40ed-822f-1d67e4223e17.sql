-- Narrow financial_journal SELECT to specific internal roles (was: any non-portal authenticated user).
DROP POLICY IF EXISTS "Authenticated can read journal" ON public.financial_journal;
CREATE POLICY "financial_journal_internal_read"
ON public.financial_journal
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
);

-- Remove broad cross-hospital profile visibility for analysts/validators.
-- Sensitive fields (email/phone/cpf/birth_date) are no longer visible via the workflow policy.
-- Self and admin/diretor policies remain intact.
DROP POLICY IF EXISTS profiles_workflow_select ON public.profiles;
DROP POLICY IF EXISTS doctors_view_internal_only ON public.doctors;

CREATE POLICY doctors_view_internal_only ON public.doctors
FOR SELECT
TO authenticated
USING (
  NOT is_portal_user(auth.uid())
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'gestao_medica'::app_role)
  )
);
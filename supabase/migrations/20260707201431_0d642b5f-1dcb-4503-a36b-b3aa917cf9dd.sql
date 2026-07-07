DROP POLICY IF EXISTS mga_select_authenticated ON public.minimum_guarantee_applications;

CREATE POLICY mga_select_internal_roles
ON public.minimum_guarantee_applications
FOR SELECT
TO authenticated
USING (
  (public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role))
  AND (hospital_id IS NULL OR hospital_id = public.current_active_hospital())
);
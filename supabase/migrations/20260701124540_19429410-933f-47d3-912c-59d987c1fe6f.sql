DROP POLICY IF EXISTS "csla_view_authenticated" ON public.company_sla_overrides;

CREATE POLICY "csla_view_internal_staff"
ON public.company_sla_overrides
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'diretor')
  OR public.has_role(auth.uid(), 'validador')
  OR public.has_role(auth.uid(), 'analista')
);
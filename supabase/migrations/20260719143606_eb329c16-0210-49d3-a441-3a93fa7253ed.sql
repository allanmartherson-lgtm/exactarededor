DROP POLICY IF EXISTS cfa_manage ON public.company_financial_adjustments;

CREATE POLICY cfa_manage
ON public.company_financial_adjustments
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'diretor'::public.app_role)
  OR public.has_role(auth.uid(), 'validador'::public.app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'diretor'::public.app_role)
  OR public.has_role(auth.uid(), 'validador'::public.app_role)
);
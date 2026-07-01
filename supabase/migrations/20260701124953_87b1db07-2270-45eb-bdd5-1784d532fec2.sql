DROP POLICY IF EXISTS "view_sector_link_suggestions" ON public.sector_link_suggestions;
DROP POLICY IF EXISTS "view_convenio_link_suggestions" ON public.convenio_link_suggestions;
DROP POLICY IF EXISTS "view_company_link_suggestions" ON public.company_link_suggestions;

CREATE POLICY "sector_link_suggestions_internal_read"
ON public.sector_link_suggestions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'diretor')
  OR public.has_role(auth.uid(), 'validador')
  OR public.has_role(auth.uid(), 'analista')
);

CREATE POLICY "convenio_link_suggestions_internal_read"
ON public.convenio_link_suggestions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'diretor')
  OR public.has_role(auth.uid(), 'validador')
  OR public.has_role(auth.uid(), 'analista')
);

CREATE POLICY "company_link_suggestions_internal_read"
ON public.company_link_suggestions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'diretor')
  OR public.has_role(auth.uid(), 'validador')
  OR public.has_role(auth.uid(), 'analista')
);
DROP POLICY IF EXISTS ff_view_authenticated ON public.feature_flags;
CREATE POLICY ff_view_internal_staff ON public.feature_flags
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
);

DROP POLICY IF EXISTS ag_view_authenticated ON public.assistance_groups;
CREATE POLICY ag_view_internal_staff ON public.assistance_groups
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
);

DROP POLICY IF EXISTS staging_require_internal_role ON public.doctors_import_staging;
CREATE POLICY staging_require_internal_role ON public.doctors_import_staging
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'diretor'::app_role) AND imported_by = auth.uid())
)
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  AND (imported_by IS NULL OR imported_by = auth.uid())
);
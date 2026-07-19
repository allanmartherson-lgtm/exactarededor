ALTER POLICY staging_admin_write ON public.doctors_import_staging
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
    AND (imported_by IS NULL OR imported_by = auth.uid())
  );

ALTER POLICY staging_require_internal_role ON public.doctors_import_staging
  WITH CHECK (
    (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
    AND (imported_by IS NULL OR imported_by = auth.uid())
  );
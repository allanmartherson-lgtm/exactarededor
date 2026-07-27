ALTER TABLE public.doctors_import_staging
  ALTER COLUMN imported_by SET DEFAULT auth.uid();

DROP POLICY IF EXISTS staging_admin_select ON public.doctors_import_staging;
DROP POLICY IF EXISTS staging_admin_write ON public.doctors_import_staging;

CREATE POLICY staging_admin_select ON public.doctors_import_staging
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR imported_by = auth.uid()
);

CREATE POLICY staging_write_insert ON public.doctors_import_staging
FOR INSERT TO authenticated
WITH CHECK (
  (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
  AND (imported_by IS NULL OR imported_by = auth.uid())
);

CREATE POLICY staging_write_update ON public.doctors_import_staging
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (public.has_role(auth.uid(), 'diretor'::app_role) AND imported_by = auth.uid())
)
WITH CHECK (
  (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'diretor'::app_role))
  AND (imported_by IS NULL OR imported_by = auth.uid())
);

CREATE POLICY staging_write_delete ON public.doctors_import_staging
FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR (public.has_role(auth.uid(), 'diretor'::app_role) AND imported_by = auth.uid())
);
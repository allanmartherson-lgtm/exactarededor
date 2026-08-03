-- 1) doctors_import_staging: escopo estrito por sessão de importação (PII)
DROP POLICY IF EXISTS "staging_admin_select" ON public.doctors_import_staging;
CREATE POLICY "staging_owner_select"
ON public.doctors_import_staging
FOR SELECT
TO authenticated
USING (
  imported_by = auth.uid()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
);

DROP POLICY IF EXISTS "staging_write_delete" ON public.doctors_import_staging;
CREATE POLICY "staging_owner_delete"
ON public.doctors_import_staging
FOR DELETE
TO authenticated
USING (
  imported_by = auth.uid()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
);

DROP POLICY IF EXISTS "staging_write_update" ON public.doctors_import_staging;
CREATE POLICY "staging_owner_update"
ON public.doctors_import_staging
FOR UPDATE
TO authenticated
USING (
  imported_by = auth.uid()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
)
WITH CHECK (
  imported_by = auth.uid()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
);

DROP POLICY IF EXISTS "staging_write_insert" ON public.doctors_import_staging;
CREATE POLICY "staging_owner_insert"
ON public.doctors_import_staging
FOR INSERT
TO authenticated
WITH CHECK (
  imported_by = auth.uid()
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
);

DROP POLICY IF EXISTS "staging_require_internal_role" ON public.doctors_import_staging;
CREATE POLICY "staging_require_owner"
ON public.doctors_import_staging
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (imported_by = auth.uid())
WITH CHECK (imported_by = auth.uid());

-- 2) rule_suggestions: INSERT sempre dentro do escopo de hospital, inclusive admin
DROP POLICY IF EXISTS "Hospital users can create rule_suggestions" ON public.rule_suggestions;
CREATE POLICY "Hospital users can create rule_suggestions"
ON public.rule_suggestions
FOR INSERT
TO authenticated
WITH CHECK (
  suggested_by = auth.uid()
  AND hospital_id IS NOT NULL
  AND public.hospital_scope_allows(hospital_id)
  AND EXISTS (
    SELECT 1 FROM public.user_hospitals uh
    WHERE uh.user_id = auth.uid() AND uh.hospital_id = rule_suggestions.hospital_id
  )
);
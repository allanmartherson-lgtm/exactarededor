-- Endurece sheet_column_templates: templates globais (hospital_id NULL) só por admin.
DROP POLICY IF EXISTS "Insert templates for accessible hospitals" ON public.sheet_column_templates;
CREATE POLICY "Insert templates for accessible hospitals"
ON public.sheet_column_templates
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    hospital_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = sheet_column_templates.hospital_id
    )
  )
);

DROP POLICY IF EXISTS "Update templates of accessible hospitals" ON public.sheet_column_templates;
CREATE POLICY "Update templates of accessible hospitals"
ON public.sheet_column_templates
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    hospital_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = sheet_column_templates.hospital_id
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    hospital_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid() AND uh.hospital_id = sheet_column_templates.hospital_id
    )
  )
);
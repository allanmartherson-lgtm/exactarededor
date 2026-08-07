ALTER TABLE public.invoice_file_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hospital_scope_restrictive"
ON public.invoice_file_versions
AS RESTRICTIVE
FOR ALL
USING (hospital_scope_allows(hospital_id))
WITH CHECK (hospital_scope_allows(hospital_id));

CREATE POLICY "active_hospital_scope"
ON public.invoice_file_versions
AS RESTRICTIVE
FOR ALL
USING ((hospital_id IS NULL) OR (hospital_id = current_active_hospital()))
WITH CHECK ((hospital_id IS NULL) OR (hospital_id = current_active_hospital()));
CREATE POLICY "agreement_registrations_insert_internal"
ON public.agreement_registrations
FOR INSERT
TO authenticated
WITH CHECK (
  (has_role(auth.uid(), 'analista'::app_role)
   OR has_role(auth.uid(), 'validador'::app_role)
   OR has_role(auth.uid(), 'gestao_medica'::app_role))
  AND hospital_id = current_active_hospital()
  AND hospital_scope_allows(hospital_id)
);
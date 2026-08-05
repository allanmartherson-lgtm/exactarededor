-- Supervisor/analista podem avançar o fluxo do acordo dentro do escopo de hospitais permitido
CREATE POLICY agreement_registrations_update_flow
ON public.agreement_registrations
FOR UPDATE
TO authenticated
USING (
  (has_role(auth.uid(), 'gestao_medica'::app_role) OR has_role(auth.uid(), 'analista'::app_role))
  AND hospital_scope_allows(hospital_id)
)
WITH CHECK (
  (has_role(auth.uid(), 'gestao_medica'::app_role) OR has_role(auth.uid(), 'analista'::app_role))
  AND hospital_scope_allows(hospital_id)
);

-- Analista/supervisor podem gravar o vínculo da regra criada no hospital de destino
CREATE POLICY agreement_registration_hospitals_update_flow
ON public.agreement_registration_hospitals
FOR UPDATE
TO authenticated
USING (
  (has_role(auth.uid(), 'gestao_medica'::app_role) OR has_role(auth.uid(), 'analista'::app_role))
  AND hospital_scope_allows(hospital_id)
)
WITH CHECK (
  (has_role(auth.uid(), 'gestao_medica'::app_role) OR has_role(auth.uid(), 'analista'::app_role))
  AND hospital_scope_allows(hospital_id)
);
DROP POLICY IF EXISTS dc_view_internal_or_portal ON public.doctor_companies;

CREATE POLICY dc_view_internal_or_portal ON public.doctor_companies
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
  OR EXISTS (
    SELECT 1 FROM doctor_portal_users dpu
    WHERE dpu.user_id = auth.uid()
      AND dpu.doctor_id = doctor_companies.doctor_id
      AND dpu.active = true
      AND doctor_companies.hospital_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM doctor_portal_user_hospitals dpuh
        WHERE dpuh.portal_user_id = dpu.id
          AND dpuh.hospital_id = doctor_companies.hospital_id
      )
  )
  OR EXISTS (
    SELECT 1 FROM company_portal_users cpu
    WHERE cpu.user_id = auth.uid()
      AND cpu.company_id = doctor_companies.company_id
      AND cpu.active = true
      AND doctor_companies.hospital_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM company_portal_user_hospitals cpuh
        WHERE cpuh.portal_user_id = cpu.id
          AND cpuh.hospital_id = doctor_companies.hospital_id
      )
  )
);
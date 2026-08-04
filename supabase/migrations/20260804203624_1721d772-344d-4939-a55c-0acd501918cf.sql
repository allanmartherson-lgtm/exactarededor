-- 1) communication_sla_settings: SELECT só para equipe interna
DROP POLICY IF EXISTS comm_sla_select_authenticated ON public.communication_sla_settings;
CREATE POLICY comm_sla_select_internal
ON public.communication_sla_settings
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
);

-- 2) doctor_companies: equipe interna limitada ao escopo de hospital
DROP POLICY IF EXISTS dc_view_internal_or_portal ON public.doctor_companies;
CREATE POLICY dc_view_internal_or_portal
ON public.doctor_companies
FOR SELECT
TO authenticated
USING (
  (
    (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'diretor'::app_role)
      OR has_role(auth.uid(), 'analista'::app_role)
      OR has_role(auth.uid(), 'validador'::app_role)
      OR has_role(auth.uid(), 'gestao_medica'::app_role)
    )
    AND hospital_scope_allows(hospital_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.doctor_portal_users dpu
    WHERE dpu.user_id = auth.uid()
      AND dpu.doctor_id = doctor_companies.doctor_id
      AND dpu.active = true
      AND doctor_companies.hospital_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.doctor_portal_user_hospitals dpuh
        WHERE dpuh.portal_user_id = dpu.id
          AND dpuh.hospital_id = doctor_companies.hospital_id
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.company_portal_users cpu
    WHERE cpu.user_id = auth.uid()
      AND cpu.company_id = doctor_companies.company_id
      AND cpu.active = true
      AND doctor_companies.hospital_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.company_portal_user_hospitals cpuh
        WHERE cpuh.portal_user_id = cpu.id
          AND cpuh.hospital_id = doctor_companies.hospital_id
      )
  )
);

-- 3) specialties: catálogo interno
DROP POLICY IF EXISTS specialties_select_authenticated ON public.specialties;
CREATE POLICY specialties_select_internal
ON public.specialties
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
);

-- 4) tuss_procedure_names: catálogo interno
DROP POLICY IF EXISTS "Authenticated can read TUSS names" ON public.tuss_procedure_names;
CREATE POLICY tuss_names_select_internal
ON public.tuss_procedure_names
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
);
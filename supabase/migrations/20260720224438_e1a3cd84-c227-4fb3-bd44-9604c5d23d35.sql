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
    SELECT 1 FROM public.doctor_portal_users dpu
    WHERE dpu.user_id = auth.uid()
      AND dpu.doctor_id = doctor_companies.doctor_id
      AND dpu.active = true
  )
  OR EXISTS (
    SELECT 1 FROM public.company_portal_users cpu
    WHERE cpu.user_id = auth.uid()
      AND cpu.company_id = doctor_companies.company_id
      AND cpu.active = true
  )
);
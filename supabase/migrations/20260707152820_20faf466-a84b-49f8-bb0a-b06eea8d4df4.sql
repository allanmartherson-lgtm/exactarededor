-- Centros de custo são cadastro GLOBAL (hospital_id NULL por design, conforme memory registry-scope-per-hospital).
-- A policy RESTRICTIVE hospital_scope_restrictive usa hospital_scope_allows(), que rejeita NULL para quem
-- não é role global — bloqueando SELECT do combobox e demais telas para usuários operacionais.
-- Substituímos por uma restritiva específica que aceita NULL (global) OU hospital do usuário.

DROP POLICY IF EXISTS hospital_scope_restrictive ON public.cost_centers;

CREATE POLICY hospital_scope_restrictive
  ON public.cost_centers
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (hospital_id IS NULL OR public.hospital_scope_allows(hospital_id))
  WITH CHECK (hospital_id IS NULL OR public.hospital_scope_allows(hospital_id));
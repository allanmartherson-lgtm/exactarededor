DROP POLICY IF EXISTS procedure_aliases_hospital_isolation ON public.procedure_aliases;
CREATE POLICY procedure_aliases_hospital_isolation ON public.procedure_aliases
  AS PERMISSIVE FOR ALL TO authenticated
  USING (hospital_id = current_active_hospital())
  WITH CHECK (hospital_id = current_active_hospital());

DROP POLICY IF EXISTS aurum_margem_medico_hospital_isolation ON public.aurum_margem_medico;
CREATE POLICY aurum_margem_medico_hospital_isolation ON public.aurum_margem_medico
  AS PERMISSIVE FOR ALL TO authenticated
  USING (hospital_id = current_active_hospital())
  WITH CHECK (hospital_id = current_active_hospital());

DROP POLICY IF EXISTS aurum_margem_procedimento_hospital_isolation ON public.aurum_margem_procedimento;
CREATE POLICY aurum_margem_procedimento_hospital_isolation ON public.aurum_margem_procedimento
  AS PERMISSIVE FOR ALL TO authenticated
  USING (hospital_id = current_active_hospital())
  WITH CHECK (hospital_id = current_active_hospital());

DROP POLICY IF EXISTS simulacao_cenario_hospital_isolation ON public.simulacao_cenario;
CREATE POLICY simulacao_cenario_hospital_isolation ON public.simulacao_cenario
  AS PERMISSIVE FOR ALL TO authenticated
  USING (hospital_id = current_active_hospital())
  WITH CHECK (hospital_id = current_active_hospital());
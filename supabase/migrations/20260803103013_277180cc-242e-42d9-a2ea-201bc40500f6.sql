-- Defesa em profundidade: embute o escopo de hospital/estado diretamente nas
-- políticas permissivas de SELECT. As condições espelham exatamente as políticas
-- RESTRICTIVE já existentes, portanto o acesso efetivo não muda.

DROP POLICY IF EXISTS "convenios_view_authenticated" ON public.convenios;
CREATE POLICY "convenios_view_authenticated" ON public.convenios
FOR SELECT TO authenticated
USING (
  (is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital())
  AND state_scope_allows(state_uf::text)
);

DROP POLICY IF EXISTS "cost_centers_view_authenticated" ON public.cost_centers;
CREATE POLICY "cost_centers_view_authenticated" ON public.cost_centers
FOR SELECT TO authenticated
USING (
  (hospital_id IS NULL OR hospital_scope_allows(hospital_id))
  AND (hospital_id IS NULL OR hospital_id = current_active_hospital())
);

DROP POLICY IF EXISTS "manual_intervention_reasons select all authenticated" ON public.manual_intervention_reasons;
CREATE POLICY "manual_intervention_reasons select all authenticated" ON public.manual_intervention_reasons
FOR SELECT TO authenticated
USING (
  is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital()
);

DROP POLICY IF EXISTS "ref_tables_view_authenticated" ON public.reference_tables;
CREATE POLICY "ref_tables_view_authenticated" ON public.reference_tables
FOR SELECT TO authenticated
USING (
  (is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital())
  AND (hospital_id IS NULL OR hospital_id = current_active_hospital())
);

DROP POLICY IF EXISTS "sectors_view_authenticated" ON public.sectors;
CREATE POLICY "sectors_view_authenticated" ON public.sectors
FOR SELECT TO authenticated
USING (
  (is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital())
  AND state_scope_allows(state_uf::text)
);

DROP POLICY IF EXISTS "sla_view_authenticated" ON public.sla_settings;
CREATE POLICY "sla_view_authenticated" ON public.sla_settings
FOR SELECT TO authenticated
USING (
  (is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital())
  AND (hospital_id IS NULL OR hospital_id = current_active_hospital())
);

DROP POLICY IF EXISTS "special_case_types_select" ON public.special_case_types;
CREATE POLICY "special_case_types_select" ON public.special_case_types
FOR SELECT TO authenticated
USING (
  is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital()
);

DROP POLICY IF EXISTS "vr_view_authenticated" ON public.validation_rules;
CREATE POLICY "vr_view_authenticated" ON public.validation_rules
FOR SELECT TO authenticated
USING (
  hospital_scope_allows(hospital_id)
  AND (hospital_id IS NULL OR hospital_id = current_active_hospital())
);
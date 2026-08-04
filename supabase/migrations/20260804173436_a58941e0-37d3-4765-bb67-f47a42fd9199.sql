-- 1. Leitura de aliases: escopo explícito por hospital + estado (antes: USING (true))
DROP POLICY IF EXISTS convenio_aliases_select_auth ON public.convenio_aliases;
CREATE POLICY convenio_aliases_select_auth ON public.convenio_aliases
FOR SELECT TO authenticated
USING (
  (is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital())
  AND state_scope_allows(state_uf::text)
);

DROP POLICY IF EXISTS sector_aliases_select_auth ON public.sector_aliases;
CREATE POLICY sector_aliases_select_auth ON public.sector_aliases
FOR SELECT TO authenticated
USING (
  (is_global_role(auth.uid()) OR hospital_id IS NULL OR hospital_id = current_active_hospital())
  AND state_scope_allows(state_uf::text)
);

-- doctor_aliases não tem hospital_id: escopo é estadual.
DROP POLICY IF EXISTS doctor_aliases_select_auth ON public.doctor_aliases;
CREATE POLICY doctor_aliases_select_auth ON public.doctor_aliases
FOR SELECT TO authenticated
USING (state_scope_allows(state_uf::text));

-- 2. Preferências de notificação: usuário só escreve para médico ao qual está vinculado
DROP POLICY IF EXISTS dnp_update_self ON public.doctor_notification_preferences;
CREATE POLICY dnp_update_self ON public.doctor_notification_preferences
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND (
    doctor_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.doctor_portal_users dpu
      WHERE dpu.user_id = auth.uid() AND dpu.doctor_id = doctor_notification_preferences.doctor_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['admin'::app_role, 'analista'::app_role, 'validador'::app_role, 'diretor'::app_role])
    )
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND (
    doctor_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.doctor_portal_users dpu
      WHERE dpu.user_id = auth.uid() AND dpu.doctor_id = doctor_notification_preferences.doctor_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['admin'::app_role, 'analista'::app_role, 'validador'::app_role, 'diretor'::app_role])
    )
  )
);

DROP POLICY IF EXISTS dnp_upsert_self ON public.doctor_notification_preferences;
CREATE POLICY dnp_upsert_self ON public.doctor_notification_preferences
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    doctor_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.doctor_portal_users dpu
      WHERE dpu.user_id = auth.uid() AND dpu.doctor_id = doctor_notification_preferences.doctor_id
    )
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = ANY (ARRAY['admin'::app_role, 'analista'::app_role, 'validador'::app_role, 'diretor'::app_role])
    )
  )
);

-- 3. user_states: políticas restritas a authenticated (antes: role public)
DROP POLICY IF EXISTS user_states_view_self ON public.user_states;
CREATE POLICY user_states_view_self ON public.user_states
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_states_manage_admin_diretor ON public.user_states;
CREATE POLICY user_states_manage_admin_diretor ON public.user_states
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));
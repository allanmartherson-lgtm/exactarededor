
-- 1) comm_campaign_recipients: portais empresa/médico precisam ler suas próprias linhas
--    (já podem dar UPDATE; sem SELECT eles nem enxergam o que podem atualizar).
CREATE POLICY "campaign_recipients_empresa_select"
ON public.comm_campaign_recipients
FOR SELECT
TO authenticated
USING (
  target_type = 'empresa'
  AND target_id IN (
    SELECT company_portal_users.company_id
    FROM public.company_portal_users
    WHERE company_portal_users.user_id = auth.uid()
      AND company_portal_users.active = true
  )
);

CREATE POLICY "campaign_recipients_medico_select"
ON public.comm_campaign_recipients
FOR SELECT
TO authenticated
USING (
  target_type = 'medico'
  AND target_id IN (
    SELECT doctor_portal_users.doctor_id
    FROM public.doctor_portal_users
    WHERE doctor_portal_users.user_id = auth.uid()
      AND doctor_portal_users.active = true
  )
);

-- 2) hospital_switch_log: usuário pode ler o próprio histórico de troca de hospital
CREATE POLICY "users read own switch log"
ON public.hospital_switch_log
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

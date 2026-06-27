
DROP POLICY IF EXISTS campaign_recipients_internal_all ON public.comm_campaign_recipients;
CREATE POLICY campaign_recipients_internal_all ON public.comm_campaign_recipients
  AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role) OR has_role(auth.uid(), 'analista'::app_role) OR has_role(auth.uid(), 'validador'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role) OR has_role(auth.uid(), 'analista'::app_role) OR has_role(auth.uid(), 'validador'::app_role));

DROP POLICY IF EXISTS campaigns_internal_all ON public.comm_campaigns;
CREATE POLICY campaigns_internal_all ON public.comm_campaigns
  AS PERMISSIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role) OR has_role(auth.uid(), 'analista'::app_role) OR has_role(auth.uid(), 'validador'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role) OR has_role(auth.uid(), 'analista'::app_role) OR has_role(auth.uid(), 'validador'::app_role));

DROP POLICY IF EXISTS dm_internal_all ON public.doctor_messages;
CREATE POLICY dm_internal_all ON public.doctor_messages
  AS PERMISSIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_roles WHERE user_roles.user_id = auth.uid() AND user_roles.role = ANY (ARRAY['admin'::app_role, 'analista'::app_role, 'validador'::app_role, 'diretor'::app_role])));

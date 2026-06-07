-- comm_campaigns: incluir validador no acesso interno
DROP POLICY IF EXISTS campaigns_internal_all ON public.comm_campaigns;
CREATE POLICY campaigns_internal_all ON public.comm_campaigns
  FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
  );

-- comm_campaign_recipients: incluir validador
DROP POLICY IF EXISTS campaign_recipients_internal_all ON public.comm_campaign_recipients;
CREATE POLICY campaign_recipients_internal_all ON public.comm_campaign_recipients
  FOR ALL
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
  );
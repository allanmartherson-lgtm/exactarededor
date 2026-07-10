
-- Isola o cross-check de destinatários em funções SECURITY DEFINER,
-- eliminando a recursão comm_campaigns <-> comm_campaign_recipients.

CREATE OR REPLACE FUNCTION public.user_is_empresa_recipient_of(_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comm_campaign_recipients r
    JOIN public.company_portal_users u ON u.company_id = r.target_id
    WHERE r.campaign_id = _campaign_id
      AND r.target_type = 'empresa'
      AND u.user_id = auth.uid()
      AND u.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_medico_recipient_of(_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.comm_campaign_recipients r
    JOIN public.doctor_portal_users u ON u.doctor_id = r.target_id
    WHERE r.campaign_id = _campaign_id
      AND r.target_type = 'medico'
      AND u.user_id = auth.uid()
      AND u.active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_is_empresa_recipient_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_is_medico_recipient_of(uuid) TO authenticated;

DROP POLICY IF EXISTS campaigns_empresa_select_targeted ON public.comm_campaigns;
DROP POLICY IF EXISTS campaigns_medico_select_targeted ON public.comm_campaigns;

CREATE POLICY campaigns_empresa_select_targeted
  ON public.comm_campaigns
  FOR SELECT
  USING (public.user_is_empresa_recipient_of(id));

CREATE POLICY campaigns_medico_select_targeted
  ON public.comm_campaigns
  FOR SELECT
  USING (public.user_is_medico_recipient_of(id));

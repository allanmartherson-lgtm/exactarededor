
-- ===========================================================
-- COMM CAMPAIGNS (broadcast / mensagens em massa)
-- ===========================================================

CREATE TABLE IF NOT EXISTS public.comm_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid,
  title text NOT NULL,
  message text NOT NULL,
  channels text[] NOT NULL DEFAULT ARRAY['portal']::text[],   -- subset of {portal,email,whatsapp}
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- audience shape:
  --  { mode: 'and' | 'or',
  --    companies: uuid[],
  --    specialties: text[],
  --    doctors: uuid[] }
  allow_reply boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','agendada','enviando','concluida','cancelada','falhou')),
  scheduled_for timestamptz,
  dispatched_at timestamptz,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comm_campaigns TO authenticated;
GRANT ALL ON public.comm_campaigns TO service_role;

ALTER TABLE public.comm_campaigns ENABLE ROW LEVEL SECURITY;

-- Equipe interna gerencia tudo
CREATE POLICY "campaigns_internal_all" ON public.comm_campaigns
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'analista')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'analista')
  );

CREATE INDEX IF NOT EXISTS idx_comm_campaigns_status ON public.comm_campaigns(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_comm_campaigns_created ON public.comm_campaigns(created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_comm_campaigns_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_comm_campaigns_updated_at ON public.comm_campaigns;
CREATE TRIGGER trg_comm_campaigns_updated_at
  BEFORE UPDATE ON public.comm_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.tg_comm_campaigns_updated_at();

-- ===========================================================
-- COMM CAMPAIGN RECIPIENTS
-- ===========================================================

CREATE TABLE IF NOT EXISTS public.comm_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.comm_campaigns(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('empresa','medico')),
  target_id uuid NOT NULL,
  name_snapshot text,
  email_snapshot text,
  phone_snapshot text,
  portal_read_at timestamptz,
  email_status text CHECK (email_status IN ('pending','sent','failed','skipped')) DEFAULT 'pending',
  email_sent_at timestamptz,
  email_error text,
  whatsapp_status text CHECK (whatsapp_status IN ('pending','sent','failed','skipped')) DEFAULT 'pending',
  whatsapp_sent_at timestamptz,
  whatsapp_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, target_type, target_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comm_campaign_recipients TO authenticated;
GRANT ALL ON public.comm_campaign_recipients TO service_role;

ALTER TABLE public.comm_campaign_recipients ENABLE ROW LEVEL SECURITY;

-- Internal staff full access
CREATE POLICY "campaign_recipients_internal_all" ON public.comm_campaign_recipients
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'analista')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
    OR public.has_role(auth.uid(), 'analista')
  );

-- Empresa: vê e marca como lida apenas as próprias linhas
CREATE POLICY "campaign_recipients_empresa_select" ON public.comm_campaign_recipients
  FOR SELECT TO authenticated
  USING (
    target_type = 'empresa'
    AND target_id IN (
      SELECT company_id FROM public.company_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "campaign_recipients_empresa_update" ON public.comm_campaign_recipients
  FOR UPDATE TO authenticated
  USING (
    target_type = 'empresa'
    AND target_id IN (
      SELECT company_id FROM public.company_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  )
  WITH CHECK (
    target_type = 'empresa'
    AND target_id IN (
      SELECT company_id FROM public.company_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

-- Médico: vê e marca como lida apenas as próprias linhas
CREATE POLICY "campaign_recipients_medico_select" ON public.comm_campaign_recipients
  FOR SELECT TO authenticated
  USING (
    target_type = 'medico'
    AND target_id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE POLICY "campaign_recipients_medico_update" ON public.comm_campaign_recipients
  FOR UPDATE TO authenticated
  USING (
    target_type = 'medico'
    AND target_id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  )
  WITH CHECK (
    target_type = 'medico'
    AND target_id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_campaign_recip_campaign ON public.comm_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_recip_target ON public.comm_campaign_recipients(target_type, target_id);

-- Empresa também precisa ver os campos da campanha para renderizar título/mensagem
CREATE POLICY "campaigns_empresa_select_targeted" ON public.comm_campaigns
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.comm_campaign_recipients r
      WHERE r.campaign_id = comm_campaigns.id
        AND r.target_type = 'empresa'
        AND r.target_id IN (
          SELECT company_id FROM public.company_portal_users
          WHERE user_id = auth.uid() AND active = true
        )
    )
  );

CREATE POLICY "campaigns_medico_select_targeted" ON public.comm_campaigns
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.comm_campaign_recipients r
      WHERE r.campaign_id = comm_campaigns.id
        AND r.target_type = 'medico'
        AND r.target_id IN (
          SELECT doctor_id FROM public.doctor_portal_users
          WHERE user_id = auth.uid() AND active = true
        )
    )
  );

-- ===========================================================
-- Realtime
-- ===========================================================
ALTER TABLE public.comm_campaigns REPLICA IDENTITY FULL;
ALTER TABLE public.comm_campaign_recipients REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='comm_campaigns') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comm_campaigns;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='comm_campaign_recipients') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.comm_campaign_recipients;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

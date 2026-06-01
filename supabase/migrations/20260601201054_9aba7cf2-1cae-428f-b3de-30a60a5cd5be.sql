
-- ============================================================
-- 1) Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.notification_channel AS ENUM ('email', 'whatsapp', 'both', 'off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_delivery_status AS ENUM ('queued', 'sent', 'delivered', 'read', 'failed', 'bounced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.magic_link_action AS ENUM ('approve', 'reject', 'return_to_analyst', 'return_to_validator', 'view');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2) profiles extensions
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at timestamptz;

-- ============================================================
-- 3) notification_queue extensions (channel routing)
-- ============================================================
ALTER TABLE public.notification_queue
  ADD COLUMN IF NOT EXISTS channel public.notification_channel,
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS target_address text;

-- ============================================================
-- 4) notification_channels (per-user preferences)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event_key text NOT NULL,
  channel public.notification_channel NOT NULL DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_channels TO authenticated;
GRANT ALL ON public.notification_channels TO service_role;

ALTER TABLE public.notification_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_can_view_own_channels"
  ON public.notification_channels FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "user_can_upsert_own_channels"
  ON public.notification_channels FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_can_update_own_channels"
  ON public.notification_channels FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_can_delete_own_channels"
  ON public.notification_channels FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_notif_channels_user ON public.notification_channels(user_id);

-- ============================================================
-- 5) notification_deliveries (audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid,
  user_id uuid,
  payment_id uuid,
  event_key text NOT NULL,
  channel public.notification_channel NOT NULL,
  target_address text NOT NULL,
  template_key text,
  status public.notification_delivery_status NOT NULL DEFAULT 'queued',
  provider_message_id text,
  provider_response jsonb,
  error_message text,
  attempts int NOT NULL DEFAULT 0,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_deliveries TO authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_sees_own_deliveries_or_admin"
  ON public.notification_deliveries FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'diretor')
  );

CREATE INDEX IF NOT EXISTS idx_notif_deliv_user ON public.notification_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_deliv_payment ON public.notification_deliveries(payment_id);
CREATE INDEX IF NOT EXISTS idx_notif_deliv_status ON public.notification_deliveries(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_deliv_provider_msg ON public.notification_deliveries(provider_message_id);

-- ============================================================
-- 6) magic_link_tokens (single-use approval links)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.magic_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  action public.magic_link_action NOT NULL,
  payment_id uuid,
  company_group_id uuid,
  issued_to_user_id uuid NOT NULL,
  issued_to_email text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  used_by_ip text,
  used_by_user_agent text,
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.magic_link_tokens TO service_role;

ALTER TABLE public.magic_link_tokens ENABLE ROW LEVEL SECURITY;

-- No authenticated/anon access — only service_role from edge functions.
CREATE POLICY "no_api_access_magic_links"
  ON public.magic_link_tokens FOR SELECT TO authenticated
  USING (false);

CREATE INDEX IF NOT EXISTS idx_magic_tokens_user ON public.magic_link_tokens(issued_to_user_id);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_payment ON public.magic_link_tokens(payment_id);
CREATE INDEX IF NOT EXISTS idx_magic_tokens_expires ON public.magic_link_tokens(expires_at) WHERE used_at IS NULL;

-- ============================================================
-- 7) whatsapp_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  event_key text NOT NULL,
  provider_template_sid text NOT NULL,
  language_code text NOT NULL DEFAULT 'pt_BR',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.whatsapp_templates TO authenticated;
GRANT ALL ON public.whatsapp_templates TO service_role;

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_can_read_active_templates"
  ON public.whatsapp_templates FOR SELECT TO authenticated
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admin_can_manage_templates"
  ON public.whatsapp_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 8) updated_at triggers
-- ============================================================
DROP TRIGGER IF EXISTS trg_notif_channels_updated_at ON public.notification_channels;
CREATE TRIGGER trg_notif_channels_updated_at
  BEFORE UPDATE ON public.notification_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notif_deliv_updated_at ON public.notification_deliveries;
CREATE TRIGGER trg_notif_deliv_updated_at
  BEFORE UPDATE ON public.notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_whatsapp_templates_updated_at ON public.whatsapp_templates;
CREATE TRIGGER trg_whatsapp_templates_updated_at
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 9) Seed event_keys catalog as configuration (optional)
-- ============================================================
INSERT INTO public.system_configurations(key, value, description)
VALUES (
  'notification.event_catalog',
  jsonb_build_array(
    jsonb_build_object('key','validator_assignment','label','Atribuição ao validador'),
    jsonb_build_object('key','director_approval','label','Aprovação pendente do diretor'),
    jsonb_build_object('key','internal_question','label','Nova pergunta interna'),
    jsonb_build_object('key','question_reply','label','Resposta de pergunta'),
    jsonb_build_object('key','batch_returned','label','Lote devolvido'),
    jsonb_build_object('key','invoice_received','label','NF recebida'),
    jsonb_build_object('key','invoice_issue','label','NF questionada/divergente')
  ),
  'Catálogo de eventos disparadores de notificação'
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

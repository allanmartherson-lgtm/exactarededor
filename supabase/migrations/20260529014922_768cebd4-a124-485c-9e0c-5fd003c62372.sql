-- ============================================================
-- ONDA 4: Notificações in-app + preferências (portal médico)
-- ============================================================

-- 1) Tabela de notificações in-app
CREATE TABLE public.doctor_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,              -- 'nova_mensagem' | 'mudanca_status' | 'novo_pagamento'
  title TEXT NOT NULL,
  body TEXT,
  payment_id UUID,
  payment_item_id UUID,
  link_path TEXT,                  -- ex.: '/mensagens' ou '/item/<id>'
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dn_user_created ON public.doctor_notifications (user_id, created_at DESC);
CREATE INDEX idx_dn_user_unread ON public.doctor_notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX idx_dn_doctor ON public.doctor_notifications (doctor_id);

GRANT SELECT, UPDATE ON public.doctor_notifications TO authenticated;
GRANT ALL ON public.doctor_notifications TO service_role;

ALTER TABLE public.doctor_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY dn_select_self ON public.doctor_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY dn_update_self ON public.doctor_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY dn_internal_all ON public.doctor_notifications
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
       WHERE user_id = auth.uid()
         AND role = ANY (ARRAY['admin','analista','validador','diretor']::app_role[])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_roles
       WHERE user_id = auth.uid()
         AND role = ANY (ARRAY['admin','analista','validador','diretor']::app_role[])
    )
  );

-- 2) Tabela de preferências
CREATE TABLE public.doctor_notification_preferences (
  user_id UUID PRIMARY KEY,
  doctor_id UUID NOT NULL,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  notify_new_message BOOLEAN NOT NULL DEFAULT true,
  notify_status_change BOOLEAN NOT NULL DEFAULT true,
  notify_new_payment BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.doctor_notification_preferences TO authenticated;
GRANT ALL ON public.doctor_notification_preferences TO service_role;

ALTER TABLE public.doctor_notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY dnp_select_self ON public.doctor_notification_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY dnp_upsert_self ON public.doctor_notification_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY dnp_update_self ON public.doctor_notification_preferences
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY dnp_internal_view ON public.doctor_notification_preferences
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
       WHERE user_id = auth.uid()
         AND role = ANY (ARRAY['admin','analista','validador','diretor']::app_role[])
    )
  );

-- 3) Helper: cria notificações para todos os usuários do portal vinculados ao doctor
CREATE OR REPLACE FUNCTION public.enqueue_doctor_notification(
  p_doctor_id UUID,
  p_type TEXT,
  p_title TEXT,
  p_body TEXT,
  p_payment_id UUID DEFAULT NULL,
  p_payment_item_id UUID DEFAULT NULL,
  p_link_path TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_pref_col TEXT;
BEGIN
  v_pref_col := CASE p_type
    WHEN 'nova_mensagem'   THEN 'notify_new_message'
    WHEN 'mudanca_status'  THEN 'notify_status_change'
    WHEN 'novo_pagamento'  THEN 'notify_new_payment'
    ELSE NULL
  END;

  INSERT INTO doctor_notifications (
    doctor_id, user_id, type, title, body,
    payment_id, payment_item_id, link_path
  )
  SELECT dpu.doctor_id, dpu.user_id, p_type, p_title, p_body,
         p_payment_id, p_payment_item_id, p_link_path
    FROM doctor_portal_users dpu
    LEFT JOIN doctor_notification_preferences pref ON pref.user_id = dpu.user_id
   WHERE dpu.doctor_id = p_doctor_id
     AND dpu.active = true
     AND (
       v_pref_col IS NULL
       OR pref.user_id IS NULL  -- sem preferência = default = true
       OR (v_pref_col = 'notify_new_message'  AND COALESCE(pref.notify_new_message, true))
       OR (v_pref_col = 'notify_status_change' AND COALESCE(pref.notify_status_change, true))
       OR (v_pref_col = 'notify_new_payment'   AND COALESCE(pref.notify_new_payment, true))
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4) Trigger: nova mensagem interna → notifica médico
CREATE OR REPLACE FUNCTION public.tg_doctor_message_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_preview TEXT;
BEGIN
  IF NEW.author_type = 'medico' THEN
    RETURN NEW;
  END IF;

  v_preview := LEFT(COALESCE(NEW.message, ''), 140);

  PERFORM enqueue_doctor_notification(
    NEW.doctor_id,
    'nova_mensagem',
    'Nova mensagem de ' || COALESCE(NEW.author_name, 'equipe'),
    v_preview,
    NEW.payment_id,
    NEW.payment_item_id,
    '/mensagens'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doctor_message_notify ON public.doctor_messages;
CREATE TRIGGER trg_doctor_message_notify
AFTER INSERT ON public.doctor_messages
FOR EACH ROW EXECUTE FUNCTION public.tg_doctor_message_notify();

-- 5) Trigger: mudança de status do pagamento → notifica médicos do lote
CREATE OR REPLACE FUNCTION public.tg_payment_status_notify_doctors()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor RECORD;
  v_status_label TEXT;
  v_ref TEXT;
BEGIN
  IF NEW.status IS NULL OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Só notifica status relevantes para o médico
  IF NEW.status::TEXT NOT IN (
    'aprovado','aprovado_com_ressalva','aprovado_parcial',
    'pago','rejeitado','cancelado','nf_conciliada','lancado'
  ) THEN
    RETURN NEW;
  END IF;

  v_status_label := CASE NEW.status::TEXT
    WHEN 'aprovado' THEN 'aprovado'
    WHEN 'aprovado_com_ressalva' THEN 'aprovado com ressalva'
    WHEN 'aprovado_parcial' THEN 'aprovado parcialmente'
    WHEN 'pago' THEN 'pago'
    WHEN 'rejeitado' THEN 'rejeitado'
    WHEN 'cancelado' THEN 'cancelado'
    WHEN 'nf_conciliada' THEN 'com NF conciliada'
    WHEN 'lancado' THEN 'lançado'
    ELSE NEW.status::TEXT
  END;

  v_ref := COALESCE(NEW.reference, 'lote');

  FOR v_doctor IN
    SELECT DISTINCT pi.doctor_id
      FROM payment_items pi
     WHERE pi.payment_id = NEW.id
       AND pi.doctor_id IS NOT NULL
  LOOP
    PERFORM enqueue_doctor_notification(
      v_doctor.doctor_id,
      'mudanca_status',
      'Pagamento ' || v_status_label,
      'O pagamento ' || v_ref || ' está ' || v_status_label || '.',
      NEW.id,
      NULL,
      '/pagamentos'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_status_notify_doctors ON public.payments;
CREATE TRIGGER trg_payment_status_notify_doctors
AFTER UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payment_status_notify_doctors();

-- 6) RPCs para o portal
CREATE OR REPLACE FUNCTION public.get_doctor_notifications(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  type TEXT,
  title TEXT,
  body TEXT,
  payment_id UUID,
  payment_item_id UUID,
  link_path TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, type, title, body, payment_id, payment_item_id, link_path, read_at, created_at
    FROM doctor_notifications
   WHERE user_id = auth.uid()
   ORDER BY created_at DESC
   LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_notifications(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_doctor_notification_unread_count()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER FROM doctor_notifications
   WHERE user_id = auth.uid() AND read_at IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_notification_unread_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_doctor_notification_read(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE doctor_notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = p_id AND user_id = auth.uid();
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_doctor_notification_read(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_all_doctor_notifications_read()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE doctor_notifications
     SET read_at = now()
   WHERE user_id = auth.uid() AND read_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_all_doctor_notifications_read() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_doctor_notification_preferences()
RETURNS TABLE (
  email_enabled BOOLEAN,
  notify_new_message BOOLEAN,
  notify_status_change BOOLEAN,
  notify_new_payment BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_doctor_id UUID;
BEGIN
  SELECT doctor_id INTO v_doctor_id
    FROM doctor_portal_users
   WHERE user_id = auth.uid() AND active = true
   LIMIT 1;

  IF v_doctor_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT COALESCE(pref.email_enabled, true),
         COALESCE(pref.notify_new_message, true),
         COALESCE(pref.notify_status_change, true),
         COALESCE(pref.notify_new_payment, true)
    FROM (SELECT 1) x
    LEFT JOIN doctor_notification_preferences pref ON pref.user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_notification_preferences() TO authenticated;

CREATE OR REPLACE FUNCTION public.update_doctor_notification_preferences(
  p_email_enabled BOOLEAN,
  p_notify_new_message BOOLEAN,
  p_notify_status_change BOOLEAN,
  p_notify_new_payment BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_doctor_id UUID;
BEGIN
  SELECT doctor_id INTO v_doctor_id
    FROM doctor_portal_users
   WHERE user_id = auth.uid() AND active = true
   LIMIT 1;

  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado: usuário não vinculado a médico';
  END IF;

  INSERT INTO doctor_notification_preferences (
    user_id, doctor_id, email_enabled,
    notify_new_message, notify_status_change, notify_new_payment, updated_at
  ) VALUES (
    auth.uid(), v_doctor_id, p_email_enabled,
    p_notify_new_message, p_notify_status_change, p_notify_new_payment, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email_enabled = EXCLUDED.email_enabled,
    notify_new_message = EXCLUDED.notify_new_message,
    notify_status_change = EXCLUDED.notify_status_change,
    notify_new_payment = EXCLUDED.notify_new_payment,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_doctor_notification_preferences(BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

-- 7) Realtime
ALTER TABLE public.doctor_notifications REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_notifications;

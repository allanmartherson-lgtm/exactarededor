
CREATE TABLE public.pendencia_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pendencia_id uuid NOT NULL REFERENCES public.pendencias(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  recipient_role text NOT NULL,
  priority text NOT NULL,
  reason text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pendencia_notif_log_pendencia ON public.pendencia_notification_log(pendencia_id, created_at DESC);
CREATE INDEX idx_pendencia_notif_log_recipient ON public.pendencia_notification_log(recipient_user_id, created_at DESC);

GRANT SELECT, INSERT ON public.pendencia_notification_log TO authenticated;
GRANT ALL ON public.pendencia_notification_log TO service_role;

ALTER TABLE public.pendencia_notification_log ENABLE ROW LEVEL SECURITY;

-- Qualquer analista/admin pode ver o histórico para auditoria
CREATE POLICY "Analistas veem histórico de notificações de pendências"
ON public.pendencia_notification_log FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'analista'::app_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

-- Usuário só registra notificação que ele mesmo recebeu (client-side logging)
CREATE POLICY "Usuário registra própria notificação recebida"
ON public.pendencia_notification_log FOR INSERT
TO authenticated
WITH CHECK (recipient_user_id = auth.uid());

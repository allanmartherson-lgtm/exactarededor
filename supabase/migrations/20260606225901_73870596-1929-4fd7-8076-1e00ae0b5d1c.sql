
CREATE TABLE IF NOT EXISTS public.internal_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text,
  link text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.internal_notifications TO authenticated;
GRANT ALL ON public.internal_notifications TO service_role;

ALTER TABLE public.internal_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user reads own notifications"
  ON public.internal_notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user marks own notifications as read"
  ON public.internal_notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS internal_notifications_user_unread_idx
  ON public.internal_notifications (user_id, read_at NULLS FIRST, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_notifications;

-- RPC to mark single notification as read (idempotent)
CREATE OR REPLACE FUNCTION public.mark_notification_read(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.internal_notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = _id AND user_id = auth.uid();
$$;

-- RPC to mark all my notifications as read
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.internal_notifications
     SET read_at = now()
   WHERE user_id = auth.uid() AND read_at IS NULL;
$$;

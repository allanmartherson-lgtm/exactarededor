
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  sender_ids uuid[] NOT NULL DEFAULT '{}',
  last_event_at timestamptz NOT NULL DEFAULT now(),
  first_event_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  sent_meta jsonb,
  attempts integer NOT NULL DEFAULT 0,
  debounce_seconds integer NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_queue_pending
  ON public.notification_queue (kind, payment_id)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_queue_ready
  ON public.notification_queue (last_event_at)
  WHERE sent_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_queue_pending
  ON public.notification_queue (kind, payment_id)
  WHERE sent_at IS NULL;

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
-- Sem políticas: só service_role acessa.

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_kind text,
  p_payment_id uuid,
  p_event jsonb,
  p_sender_id uuid DEFAULT NULL,
  p_debounce_seconds integer DEFAULT 60
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.notification_queue
  SET
    events = events || p_event,
    sender_ids = CASE
      WHEN p_sender_id IS NULL THEN sender_ids
      WHEN p_sender_id = ANY(sender_ids) THEN sender_ids
      ELSE sender_ids || p_sender_id
    END,
    last_event_at = now(),
    updated_at = now()
  WHERE kind = p_kind
    AND payment_id = p_payment_id
    AND sent_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO public.notification_queue (
      kind, payment_id, events, sender_ids, debounce_seconds, first_event_at, last_event_at
    ) VALUES (
      p_kind,
      p_payment_id,
      jsonb_build_array(p_event),
      CASE WHEN p_sender_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[p_sender_id] END,
      p_debounce_seconds,
      now(),
      now()
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_notification(text, uuid, jsonb, uuid, integer) TO service_role;

-- Remove cron antigo se existir
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notification-queue-worker-tick') THEN
    PERFORM cron.unschedule('notification-queue-worker-tick');
  END IF;
END $$;

-- Agenda tick a cada 30s. A função worker é deployada com verify_jwt=false,
-- então não precisa de Authorization no header.
SELECT cron.schedule(
  'notification-queue-worker-tick',
  '30 seconds',
  $cron$
  SELECT net.http_post(
    url := 'https://bexwvmnwsbltrspmwusp.functions.supabase.co/notification-queue-worker',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $cron$
);

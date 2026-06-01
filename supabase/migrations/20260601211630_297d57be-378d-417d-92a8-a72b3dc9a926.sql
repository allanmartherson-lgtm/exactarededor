-- 1. Permitir payment_id nulo (necessário para alertas de SLA do canal "doctor" sem pagamento vinculado)
ALTER TABLE public.notification_queue ALTER COLUMN payment_id DROP NOT NULL;

-- 2. Substituir o índice único pendente para não colapsar alertas de SLA de comunicação por payment_id.
-- Mantém dedupe para os demais kinds (analyst_event, director_approval, etc).
DROP INDEX IF EXISTS public.uq_notification_queue_pending;

CREATE UNIQUE INDEX uq_notification_queue_pending
  ON public.notification_queue (kind, payment_id)
  WHERE sent_at IS NULL AND kind <> 'comm_sla_breached' AND payment_id IS NOT NULL;
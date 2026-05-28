
DROP MATERIALIZED VIEW IF EXISTS public.mv_payments_flags;

CREATE OR REPLACE VIEW public.mv_payments_flags
WITH (security_invoker = true)
AS
SELECT
  p.id AS payment_id,
  EXISTS(
    SELECT 1 FROM public.payment_observations o
    WHERE o.payment_id = p.id AND o.is_question = true AND o.resolved_at IS NULL
  ) AS has_open_question,
  EXISTS(
    SELECT 1 FROM public.invoices i
    WHERE i.payment_id = p.id AND i.status = 'divergente'
  ) AS has_divergence,
  EXISTS(
    SELECT 1 FROM public.payment_items pi
    WHERE pi.payment_id = p.id
      AND pi.ai_status IN ('alerta','reprovado','erro_duplicidade_pagamento','erro_duplicidade_calculo')
  ) AS has_items_error,
  (p.priority_score >= 50) AS is_overdue
FROM public.payments p;

GRANT SELECT ON public.mv_payments_flags TO authenticated, service_role;

-- Sem refresh / sem cron. Atualiza junto com cada query.
DROP FUNCTION IF EXISTS public.refresh_mv_payments_flags();

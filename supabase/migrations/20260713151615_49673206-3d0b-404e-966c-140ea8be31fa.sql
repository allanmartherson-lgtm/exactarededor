-- ai_retry_queue lifecycle hardening
-- Alterações:
--   1) TTL 7 dias: entradas pending OU processing com created_at antigo são canceladas
--   2) Recovery de zumbi (processing com locked_at > 1h) SÓ para entradas recentes
--      (>7d cai no TTL e é cancelada). Não reseta attempts — o próximo claim
--      incrementa naturalmente até bater max_attempts.
--   3) Gate: entradas cujo payment está em status final são canceladas em vez
--      de reprocessadas.
--
-- FINAL_STATUSES abaixo é uma cópia da lista em
-- supabase/functions/apply-company-deductions/index.ts (const FINAL_STATUSES).
-- MANTER AS DUAS LISTAS SINCRONIZADAS — se alterar aqui, alterar lá (e vice-versa).

CREATE OR REPLACE FUNCTION public.claim_ai_retry_batch(p_limit int DEFAULT 5)
RETURNS SETOF public.ai_retry_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ============ 1) TTL 7 dias (aplica a pending E processing) ============
  -- Cobre inclusive zumbis velhos: se está preso em processing há mais de
  -- 7 dias desde a criação, expira em vez de ressuscitar (ajuste #1 do plano).
  UPDATE public.ai_retry_queue
     SET status = 'cancelled',
         last_error = 'TTL: entrada com mais de 7 dias desde created_at — expirada sem reprocessamento',
         finished_at = now(),
         locked_at = NULL,
         updated_at = now()
   WHERE status IN ('pending', 'processing')
     AND created_at < now() - interval '7 days';

  -- ============ 2) Gate: payment em status final ============
  -- FINAL_STATUSES espelha apply-company-deductions/index.ts (MANTER SINCRONIZADO).
  UPDATE public.ai_retry_queue q
     SET status = 'cancelled',
         last_error = format('payment em status final (%s) — reprocessamento IA cancelado', p.status),
         finished_at = now(),
         locked_at = NULL,
         updated_at = now()
    FROM public.payments p
   WHERE q.payment_id = p.id
     AND q.status IN ('pending', 'processing')
     AND p.status = ANY (ARRAY[
       'aprovado', 'aprovado_com_ressalva', 'aprovado_parcial',
       'pedido_nf_enviado', 'nf_recebida', 'nf_conciliada', 'nf_questionada', 'nf_divergente',
       'lancado', 'pago', 'arquivado', 'cancelado', 'rejeitado'
     ]);

  -- ============ 3) Recovery de zumbis recentes (processing > 1h, < 7d) ============
  -- Não reseta attempts: o próximo claim incrementa e o ciclo é bounded por max_attempts.
  -- Se já esgotou tentativas, vai direto para 'failed' em vez de voltar para 'pending'.
  UPDATE public.ai_retry_queue
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
         last_error = COALESCE(last_error, '') ||
                      CASE WHEN COALESCE(last_error, '') = '' THEN '' ELSE ' | ' END ||
                      'recovered from processing zombie (locked_at > 1h)',
         locked_at = NULL,
         next_attempt_at = now(),
         finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
         updated_at = now()
   WHERE status = 'processing'
     AND locked_at < now() - interval '1 hour'
     AND created_at >= now() - interval '7 days';

  -- ============ 4) Claim normal ============
  -- Só pending elegível. Zumbis já foram recuperados (viraram pending) ou cancelados/failed.
  -- attempts incrementa aqui — é a única fonte de incremento, evitando dupla contagem.
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.ai_retry_queue
    WHERE status = 'pending'
      AND attempts < max_attempts
      AND next_attempt_at <= now()
    ORDER BY next_attempt_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 20))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ai_retry_queue q
     SET status = 'processing',
         locked_at = now(),
         attempts = q.attempts + 1,
         updated_at = now()
    FROM picked
   WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_ai_retry_batch(int) TO service_role;
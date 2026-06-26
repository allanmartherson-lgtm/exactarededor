-- Corrige race condition na função log_payment_recompute_failure:
-- workers paralelos do mesmo payment caíam em UPDATE-vazio → INSERT concorrente
-- → violação de uq_recompute_failures_pending_payment. Erro propagava para o
-- worker como "Falha ao atualizar item ... duplicate key" e a empresa caía em
-- "parcial", fazendo "Reaplicar regras" exibir erro genérico ao usuário.
CREATE OR REPLACE FUNCTION public.log_payment_recompute_failure(
  _payment_id uuid, _error text, _code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- UPSERT atômico sobre o índice parcial (payment_id WHERE resolved_at IS NULL).
  INSERT INTO public.payment_recompute_failures
    (payment_id, error_message, error_code)
  VALUES (_payment_id, _error, _code)
  ON CONFLICT (payment_id) WHERE resolved_at IS NULL
  DO UPDATE SET
    attempts        = public.payment_recompute_failures.attempts + 1,
    last_attempt_at = now(),
    error_message   = EXCLUDED.error_message,
    error_code      = EXCLUDED.error_code,
    updated_at      = now();
END;
$$;
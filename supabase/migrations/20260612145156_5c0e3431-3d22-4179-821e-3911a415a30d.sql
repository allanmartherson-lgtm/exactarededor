
CREATE TABLE IF NOT EXISTS public.payment_recompute_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  error_message text NOT NULL,
  error_code text,
  attempts integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Garante apenas UMA falha pendente por pagamento (resolved_at IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_recompute_failures_pending_payment
  ON public.payment_recompute_failures (payment_id)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recompute_failures_pending
  ON public.payment_recompute_failures (last_attempt_at)
  WHERE resolved_at IS NULL;

GRANT SELECT ON public.payment_recompute_failures TO authenticated;
GRANT ALL ON public.payment_recompute_failures TO service_role;

ALTER TABLE public.payment_recompute_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins veem falhas de recompute"
  ON public.payment_recompute_failures FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'));

-- Função utilitária para registrar uma falha (UPSERT manual no índice parcial)
CREATE OR REPLACE FUNCTION public.log_payment_recompute_failure(
  _payment_id uuid, _error text, _code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.payment_recompute_failures
     SET attempts = attempts + 1,
         last_attempt_at = now(),
         error_message = _error,
         error_code = _code,
         updated_at = now()
   WHERE payment_id = _payment_id AND resolved_at IS NULL;

  IF NOT FOUND THEN
    INSERT INTO public.payment_recompute_failures
      (payment_id, error_message, error_code) VALUES (_payment_id, _error, _code);
  END IF;
END;
$$;

-- Trigger: loga falha e auto-resolve em sucesso
CREATE OR REPLACE FUNCTION public.trg_recompute_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_payment_id uuid := COALESCE(NEW.payment_id, OLD.payment_id);
BEGIN
  BEGIN
    PERFORM public.recompute_payment_status_from_groups(v_payment_id);
    UPDATE public.payment_recompute_failures
       SET resolved_at = now(), updated_at = now()
     WHERE payment_id = v_payment_id AND resolved_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.log_payment_recompute_failure(v_payment_id, SQLERRM, SQLSTATE);
    RAISE NOTICE 'recompute_payment_status_from_groups falhou [%]: %', SQLSTATE, SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Retry em lote: tenta reexecutar os mais antigos, marca resolved ou incrementa
CREATE OR REPLACE FUNCTION public.retry_payment_recompute_failures(_limit integer DEFAULT 50)
RETURNS TABLE (payment_id uuid, succeeded boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT prf.id, prf.payment_id
      FROM public.payment_recompute_failures prf
     WHERE prf.resolved_at IS NULL
     ORDER BY prf.last_attempt_at ASC
     LIMIT GREATEST(1, LEAST(_limit, 500))
  LOOP
    BEGIN
      PERFORM public.recompute_payment_status_from_groups(r.payment_id);
      UPDATE public.payment_recompute_failures
         SET resolved_at = now(), updated_at = now()
       WHERE id = r.id;
      payment_id := r.payment_id; succeeded := true; error_message := NULL;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.payment_recompute_failures
         SET attempts = attempts + 1,
             last_attempt_at = now(),
             error_message = SQLERRM,
             error_code = SQLSTATE,
             updated_at = now()
       WHERE id = r.id;
      payment_id := r.payment_id; succeeded := false; error_message := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_payment_recompute_failures(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_payment_recompute_failure(uuid, text, text) TO service_role;

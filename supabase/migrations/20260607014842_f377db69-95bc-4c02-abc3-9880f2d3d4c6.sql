
-- 1. Tabela da fila de reprocessamento da IA
CREATE TABLE IF NOT EXISTS public.ai_retry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  company_name text NOT NULL,
  hospital_id uuid,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','cancelled')),
  last_error text,
  source_job_id uuid,
  last_job_id uuid,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, company_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_retry_queue TO authenticated;
GRANT ALL ON public.ai_retry_queue TO service_role;

ALTER TABLE public.ai_retry_queue ENABLE ROW LEVEL SECURITY;

-- Leitura por usuários autenticados do hospital (mesmo padrão do dead_letter)
CREATE POLICY "Authenticated read ai_retry_queue"
  ON public.ai_retry_queue FOR SELECT
  TO authenticated
  USING (true);

-- Update manual por analistas (cancelar / forçar retry)
CREATE POLICY "Authenticated update ai_retry_queue"
  ON public.ai_retry_queue FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.tg_ai_retry_queue_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_retry_queue_set_updated_at ON public.ai_retry_queue;
CREATE TRIGGER ai_retry_queue_set_updated_at
  BEFORE UPDATE ON public.ai_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.tg_ai_retry_queue_set_updated_at();

CREATE INDEX IF NOT EXISTS ai_retry_queue_pending_idx
  ON public.ai_retry_queue (status, next_attempt_at)
  WHERE status IN ('pending','processing');

CREATE INDEX IF NOT EXISTS ai_retry_queue_payment_idx
  ON public.ai_retry_queue (payment_id);

-- 2. RPC para enfileirar (idempotente via UPSERT em payment+company)
CREATE OR REPLACE FUNCTION public.enqueue_ai_retry(
  p_payment_id uuid,
  p_company_name text,
  p_hospital_id uuid,
  p_error text,
  p_job_id uuid DEFAULT NULL,
  p_max_attempts int DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_max int;
  v_delay int;
BEGIN
  -- Configuração: lê system_configurations se existir, fallback para 3 tentativas
  v_max := COALESCE(
    p_max_attempts,
    (SELECT (value)::int FROM public.system_configurations WHERE key = 'ai_retry_max_attempts' LIMIT 1),
    3
  );

  INSERT INTO public.ai_retry_queue (
    payment_id, company_name, hospital_id,
    max_attempts, last_error, source_job_id, last_job_id,
    next_attempt_at, status
  )
  VALUES (
    p_payment_id, p_company_name, p_hospital_id,
    v_max, LEFT(COALESCE(p_error,''), 1000), p_job_id, p_job_id,
    now(), 'pending'
  )
  ON CONFLICT (payment_id, company_name) DO UPDATE
  SET
    -- só reagenda se não terminou com sucesso
    status = CASE
      WHEN public.ai_retry_queue.status = 'done' THEN 'done'
      WHEN public.ai_retry_queue.attempts >= public.ai_retry_queue.max_attempts THEN 'failed'
      ELSE 'pending'
    END,
    last_error = LEFT(COALESCE(p_error, public.ai_retry_queue.last_error), 1000),
    last_job_id = COALESCE(p_job_id, public.ai_retry_queue.last_job_id),
    -- backoff exponencial: 1min, 2min, 4min, 8min... cap 30min
    next_attempt_at = CASE
      WHEN public.ai_retry_queue.status = 'done' THEN public.ai_retry_queue.next_attempt_at
      ELSE now() + (LEAST(30, GREATEST(1, POWER(2, public.ai_retry_queue.attempts)::int)) || ' minutes')::interval
    END,
    max_attempts = GREATEST(public.ai_retry_queue.max_attempts, v_max),
    hospital_id = COALESCE(public.ai_retry_queue.hospital_id, p_hospital_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_ai_retry(uuid, text, uuid, text, uuid, int)
  TO authenticated, service_role;

-- 3. RPC para o worker reservar um lote (lock atômico)
CREATE OR REPLACE FUNCTION public.claim_ai_retry_batch(p_limit int DEFAULT 5)
RETURNS SETOF public.ai_retry_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id
    FROM public.ai_retry_queue
    WHERE status = 'pending'
      AND next_attempt_at <= now()
      AND attempts < max_attempts
    ORDER BY next_attempt_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 20))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.ai_retry_queue q
  SET status = 'processing', locked_at = now(), attempts = q.attempts + 1
  FROM picked
  WHERE q.id = picked.id
  RETURNING q.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_ai_retry_batch(int) TO service_role;

-- 4. RPC para finalizar item da fila
CREATE OR REPLACE FUNCTION public.finalize_ai_retry(
  p_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ai_retry_queue
  SET
    status = CASE
      WHEN p_success THEN 'done'
      WHEN attempts >= max_attempts THEN 'failed'
      ELSE 'pending'
    END,
    last_error = CASE WHEN p_success THEN NULL ELSE LEFT(COALESCE(p_error, last_error), 1000) END,
    next_attempt_at = CASE
      WHEN p_success OR attempts >= max_attempts THEN next_attempt_at
      ELSE now() + (LEAST(30, GREATEST(1, POWER(2, attempts)::int)) || ' minutes')::interval
    END,
    finished_at = CASE WHEN p_success OR attempts >= max_attempts THEN now() ELSE NULL END,
    locked_at = NULL
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_ai_retry(uuid, boolean, text) TO service_role;

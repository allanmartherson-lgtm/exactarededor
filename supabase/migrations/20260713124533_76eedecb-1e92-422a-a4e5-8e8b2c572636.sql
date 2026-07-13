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
    WHERE attempts < max_attempts
      AND (
        (status = 'pending' AND next_attempt_at <= now())
        OR (status = 'processing' AND locked_at < now() - interval '10 minutes')
      )
    ORDER BY
      CASE WHEN status = 'processing' THEN 0 ELSE 1 END,
      COALESCE(locked_at, next_attempt_at) ASC
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

CREATE OR REPLACE FUNCTION public.finalize_ai_retry(p_id uuid, p_success boolean, p_error text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := COALESCE(auth.role(), current_setting('request.jwt.claim.role', true));
BEGIN
  IF v_role IS DISTINCT FROM 'service_role' THEN
    PERFORM public.assert_hospital_access((
      SELECT p.hospital_id
      FROM public.ai_retry_queue r
      JOIN public.payments p ON p.id = r.payment_id
      WHERE r.id = p_id
    ));
  END IF;

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
    locked_at = NULL,
    updated_at = now()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_ai_retry(uuid, boolean, text) TO service_role;
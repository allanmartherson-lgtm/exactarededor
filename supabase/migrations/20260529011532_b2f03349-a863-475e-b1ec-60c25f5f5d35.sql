
CREATE OR REPLACE FUNCTION public.get_ai_accuracy(p_days INT DEFAULT 30)
RETURNS TABLE (
  total_analyzed BIGINT,
  kept_count BIGINT,
  overridden_count BIGINT,
  accuracy_pct NUMERIC,
  by_status JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total BIGINT;
  v_kept BIGINT;
  v_over BIGINT;
BEGIN
  SELECT COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL),
         COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL AND COALESCE(pi.authorized_exception,false) = false),
         COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL AND COALESCE(pi.authorized_exception,false) = true)
  INTO v_total, v_kept, v_over
  FROM payment_items pi
  JOIN payments p ON p.id = pi.payment_id
  WHERE p.created_at >= now() - (p_days || ' days')::interval;

  RETURN QUERY
  SELECT v_total, v_kept, v_over,
    CASE WHEN v_total > 0 THEN ROUND(100.0 * v_kept / v_total, 2) ELSE 0 END,
    COALESCE((
      SELECT jsonb_object_agg(ai_status, cnt) FROM (
        SELECT pi.ai_status, COUNT(*) AS cnt
        FROM payment_items pi
        JOIN payments p ON p.id = pi.payment_id
        WHERE p.created_at >= now() - (p_days || ' days')::interval
          AND pi.ai_status IS NOT NULL
        GROUP BY pi.ai_status
      ) s
    ), '{}'::jsonb);
END;
$$;

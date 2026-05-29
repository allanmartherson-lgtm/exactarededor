
-- Observabilidade de negócio

-- 1) Tempo médio em cada status (dwell time)
CREATE OR REPLACE FUNCTION public.get_stage_dwell_time(p_days INT DEFAULT 90)
RETURNS TABLE (
  status TEXT,
  transitions BIGINT,
  avg_hours NUMERIC,
  p50_hours NUMERIC,
  p90_hours NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ordered AS (
    SELECT payment_id, to_status AS status, changed_at,
      LEAD(changed_at) OVER (PARTITION BY payment_id ORDER BY changed_at) AS next_at
    FROM payment_status_history
    WHERE changed_at >= now() - (p_days || ' days')::interval
  ),
  durations AS (
    SELECT status,
      EXTRACT(EPOCH FROM (COALESCE(next_at, now()) - changed_at))/3600 AS hours
    FROM ordered
    WHERE next_at IS NOT NULL
  )
  SELECT d.status,
    COUNT(*)::BIGINT,
    ROUND(AVG(hours)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY hours)::NUMERIC, 2)
  FROM durations d
  GROUP BY d.status
  ORDER BY AVG(hours) DESC;
END;
$$;

-- 2) Taxa de devolução por etapa
CREATE OR REPLACE FUNCTION public.get_return_rate(p_days INT DEFAULT 30)
RETURNS TABLE (
  return_status TEXT,
  return_count BIGINT,
  total_in_stage BIGINT,
  return_rate_pct NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH returns AS (
    SELECT to_status, COUNT(*) AS c
    FROM payment_status_history
    WHERE changed_at >= now() - (p_days || ' days')::interval
      AND to_status IN ('devolvido_analista','aprovado_em_revisao','revisao_pos_aprovacao')
    GROUP BY to_status
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*) FROM payment_status_history
        WHERE to_status IN ('aguardando_validacao','devolvido_analista')
          AND changed_at >= now() - (p_days || ' days')::interval) AS validacao_total,
      (SELECT COUNT(*) FROM payment_status_history
        WHERE to_status IN ('aprovado','aprovado_em_revisao')
          AND changed_at >= now() - (p_days || ' days')::interval) AS aprovacao_total,
      (SELECT COUNT(*) FROM payment_status_history
        WHERE to_status IN ('aprovado','revisao_pos_aprovacao')
          AND changed_at >= now() - (p_days || ' days')::interval) AS pos_aprov_total
  )
  SELECT r.to_status,
    r.c::BIGINT,
    CASE r.to_status
      WHEN 'devolvido_analista' THEN t.validacao_total
      WHEN 'aprovado_em_revisao' THEN t.aprovacao_total
      WHEN 'revisao_pos_aprovacao' THEN t.pos_aprov_total
    END::BIGINT,
    CASE r.to_status
      WHEN 'devolvido_analista' THEN ROUND(100.0 * r.c / NULLIF(t.validacao_total,0), 2)
      WHEN 'aprovado_em_revisao' THEN ROUND(100.0 * r.c / NULLIF(t.aprovacao_total,0), 2)
      WHEN 'revisao_pos_aprovacao' THEN ROUND(100.0 * r.c / NULLIF(t.pos_aprov_total,0), 2)
    END
  FROM returns r CROSS JOIN totals t
  ORDER BY r.c DESC;
END;
$$;

-- 3) Acurácia da IA: % de itens onde analista NÃO sobrescreveu o resultado
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
         COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL AND COALESCE(pi.authorized_exception,false) = false AND (pi.analyst_override IS NULL OR pi.analyst_override = false)),
         COUNT(*) FILTER (WHERE pi.ai_status IS NOT NULL AND (COALESCE(pi.authorized_exception,false) = true OR pi.analyst_override = true))
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

GRANT EXECUTE ON FUNCTION public.get_stage_dwell_time(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_return_rate(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_accuracy(INT) TO authenticated;

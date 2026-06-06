CREATE OR REPLACE FUNCTION public.get_return_rate(p_days integer DEFAULT 30)
 RETURNS TABLE(return_status text, return_count bigint, total_in_stage bigint, return_rate_pct numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH returns AS (
    SELECT status_to, COUNT(*) AS c
    FROM payment_status_history
    WHERE changed_at >= now() - (p_days || ' days')::interval
      AND status_to IN ('devolvido_analista','aprovado_em_revisao','revisao_pos_aprovacao')
    GROUP BY status_to
  ),
  totals AS (
    SELECT
      (SELECT COUNT(*) FROM payment_status_history
        WHERE status_to IN ('aguardando_validacao','devolvido_analista')
          AND changed_at >= now() - (p_days || ' days')::interval) AS validacao_total,
      (SELECT COUNT(*) FROM payment_status_history
        WHERE status_to IN ('aprovado','aprovado_em_revisao')
          AND changed_at >= now() - (p_days || ' days')::interval) AS aprovacao_total,
      (SELECT COUNT(*) FROM payment_status_history
        WHERE status_to IN ('aprovado','revisao_pos_aprovacao')
          AND changed_at >= now() - (p_days || ' days')::interval) AS pos_aprov_total
  )
  SELECT r.status_to,
    r.c::BIGINT,
    CASE r.status_to
      WHEN 'devolvido_analista' THEN t.validacao_total
      WHEN 'aprovado_em_revisao' THEN t.aprovacao_total
      WHEN 'revisao_pos_aprovacao' THEN t.pos_aprov_total
    END::BIGINT,
    CASE r.status_to
      WHEN 'devolvido_analista' THEN ROUND(100.0 * r.c / NULLIF(t.validacao_total,0), 2)
      WHEN 'aprovado_em_revisao' THEN ROUND(100.0 * r.c / NULLIF(t.aprovacao_total,0), 2)
      WHEN 'revisao_pos_aprovacao' THEN ROUND(100.0 * r.c / NULLIF(t.pos_aprov_total,0), 2)
    END
  FROM returns r CROSS JOIN totals t
  ORDER BY r.c DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_stage_dwell_time(p_days integer DEFAULT 90)
 RETURNS TABLE(status text, transitions bigint, avg_hours numeric, p50_hours numeric, p90_hours numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH ordered AS (
    SELECT payment_id, status_to AS status, changed_at,
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
$function$;
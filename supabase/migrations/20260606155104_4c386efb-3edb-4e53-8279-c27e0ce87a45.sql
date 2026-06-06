CREATE OR REPLACE FUNCTION public.get_stage_dwell_time(p_days integer DEFAULT 90)
 RETURNS TABLE(status text, transitions bigint, avg_hours numeric, p50_hours numeric, p90_hours numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH ordered AS (
    SELECT payment_id, status_to::text AS st, changed_at,
      LEAD(changed_at) OVER (PARTITION BY payment_id ORDER BY changed_at) AS next_at
    FROM payment_status_history
    WHERE changed_at >= now() - (p_days || ' days')::interval
  ),
  durations AS (
    SELECT st,
      EXTRACT(EPOCH FROM (COALESCE(next_at, now()) - changed_at))/3600 AS hours
    FROM ordered
    WHERE next_at IS NOT NULL
  )
  SELECT d.st,
    COUNT(*)::BIGINT,
    ROUND(AVG(hours)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours)::NUMERIC, 2),
    ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY hours)::NUMERIC, 2)
  FROM durations d
  GROUP BY d.st
  ORDER BY AVG(hours) DESC;
END;
$function$;
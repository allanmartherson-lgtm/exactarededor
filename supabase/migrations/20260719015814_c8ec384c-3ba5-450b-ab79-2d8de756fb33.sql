
CREATE OR REPLACE FUNCTION public.get_missing_batch_patterns_for(_hospital uuid)
RETURNS TABLE(pattern_id uuid, label text, competence_month date, expected_by date, days_late integer, avg_bruto numeric, last_seen_month date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public','extensions'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_curr  date := date_trunc('month', v_today)::date;
  v_prev  date := (date_trunc('month', v_today) - interval '1 month')::date;
BEGIN
  IF _hospital IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH pats AS (
    SELECT pbp.id, pbp.label, pbp.avg_bruto, pbp.last_seen_month,
           pbp.expected_day_of_month, pbp.expected_grace_days
    FROM public.payment_batch_patterns pbp
    WHERE pbp.hospital_id = _hospital
      AND pbp.active = true
      AND pbp.alert_enabled = true
      AND pbp.months_seen >= 2
  ),
  months AS (
    SELECT p.id, p.label, p.avg_bruto, p.last_seen_month,
           v_curr AS comp,
           CASE
             WHEN p.expected_day_of_month IS NOT NULL THEN
               (v_curr + LEAST(p.expected_day_of_month, extract(day FROM (date_trunc('month', v_curr) + interval '1 month - 1 day'))::int) - 1) + (p.expected_grace_days || ' days')::interval
             ELSE
               (v_curr + interval '1 month - 1 day')
           END AS deadline
    FROM pats p
    UNION ALL
    SELECT p.id, p.label, p.avg_bruto, p.last_seen_month,
           v_prev AS comp,
           (v_prev + interval '1 month - 1 day') AS deadline
    FROM pats p
  ),
  missing AS (
    SELECT m.id, m.label, m.avg_bruto, m.last_seen_month, m.comp, m.deadline::date AS deadline
    FROM months m
    WHERE m.deadline::date < v_today
      AND NOT EXISTS (
        SELECT 1 FROM public.payments py
        WHERE py.hospital_id = _hospital
          AND py.batch_pattern_id = m.id
          AND date_trunc('month', py.competence_month) = date_trunc('month', m.comp)
      )
  )
  SELECT m.id, m.label, m.comp, m.deadline,
         (v_today - m.deadline)::int AS days_late,
         m.avg_bruto, m.last_seen_month
  FROM missing m
  ORDER BY (v_today - m.deadline) DESC, m.label;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_missing_batch_patterns_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_missing_batch_patterns_for(uuid) TO service_role, authenticated;

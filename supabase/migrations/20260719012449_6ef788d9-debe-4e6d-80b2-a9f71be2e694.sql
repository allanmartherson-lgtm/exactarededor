
-- Fase B — colunas de expectativa + detector de ausência
ALTER TABLE public.payment_batch_patterns
  ADD COLUMN IF NOT EXISTS expected_day_of_month INTEGER
    CHECK (expected_day_of_month IS NULL OR (expected_day_of_month BETWEEN 1 AND 31)),
  ADD COLUMN IF NOT EXISTS expected_grace_days INTEGER NOT NULL DEFAULT 5
    CHECK (expected_grace_days >= 0 AND expected_grace_days <= 60),
  ADD COLUMN IF NOT EXISTS alert_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.get_missing_batch_patterns()
RETURNS TABLE (
  pattern_id       uuid,
  label            text,
  competence_month date,
  expected_by      date,
  days_late        integer,
  avg_bruto        numeric,
  last_seen_month  date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
DECLARE
  v_hospital uuid := public.current_active_hospital();
  v_today    date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_curr     date := date_trunc('month', v_today)::date;
  v_prev     date := (date_trunc('month', v_today) - interval '1 month')::date;
BEGIN
  IF v_hospital IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH pats AS (
    SELECT pbp.id, pbp.label, pbp.avg_bruto, pbp.last_seen_month,
           pbp.expected_day_of_month, pbp.expected_grace_days
    FROM public.payment_batch_patterns pbp
    WHERE pbp.hospital_id = v_hospital
      AND pbp.active = true
      AND pbp.alert_enabled = true
      AND pbp.months_seen >= 2
  ),
  months AS (
    -- mês corrente
    SELECT p.id, p.label, p.avg_bruto, p.last_seen_month,
           v_curr AS comp,
           CASE
             WHEN p.expected_day_of_month IS NOT NULL THEN
               (v_curr + LEAST(p.expected_day_of_month, extract(day FROM (date_trunc('month', v_curr) + interval '1 month - 1 day'))::int) - 1) + (p.expected_grace_days || ' days')::interval
             ELSE
               (v_curr + interval '1 month - 1 day') -- fim do mês corrente
           END AS deadline
    FROM pats p
    UNION ALL
    -- mês anterior (nunca chegou)
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
        WHERE py.hospital_id = v_hospital
          AND py.batch_pattern_id = m.id
          AND py.competence_month = m.comp
          AND py.status NOT IN ('rascunho','cancelado','rejeitado')
      )
  )
  SELECT
    missing.id                                              AS pattern_id,
    missing.label                                           AS label,
    missing.comp                                            AS competence_month,
    missing.deadline                                        AS expected_by,
    (v_today - missing.deadline)::int                       AS days_late,
    missing.avg_bruto                                       AS avg_bruto,
    missing.last_seen_month                                 AS last_seen_month
  FROM missing
  ORDER BY missing.deadline ASC, missing.label ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_missing_batch_patterns() TO authenticated;

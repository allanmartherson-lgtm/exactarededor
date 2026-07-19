
CREATE OR REPLACE FUNCTION public.get_pattern_coverage(p_months integer DEFAULT 6)
RETURNS TABLE (
  month_bucket date,
  total_batches integer,
  linked_batches integer,
  coverage_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public','extensions'
AS $$
DECLARE
  v_hospital uuid := public.current_active_hospital();
  v_start date;
BEGIN
  IF v_hospital IS NULL THEN RETURN; END IF;
  v_start := (date_trunc('month', now()) - ((p_months - 1) || ' months')::interval)::date;

  RETURN QUERY
  SELECT
    date_trunc('month', p.competence_month)::date                              AS month_bucket,
    count(*)::int                                                              AS total_batches,
    count(*) FILTER (WHERE p.batch_pattern_id IS NOT NULL)::int                AS linked_batches,
    CASE WHEN count(*) = 0 THEN 0::numeric
         ELSE round(
           (count(*) FILTER (WHERE p.batch_pattern_id IS NOT NULL)::numeric * 100) / count(*)::numeric,
           1
         )
    END                                                                        AS coverage_pct
  FROM public.payments p
  WHERE p.hospital_id = v_hospital
    AND p.competence_month >= v_start
    AND p.status NOT IN ('rascunho','cancelado','rejeitado')
  GROUP BY 1
  ORDER BY 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pattern_coverage(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_pattern_stats(p_pattern_id uuid)
RETURNS TABLE (
  pattern_id uuid,
  label text,
  months_seen integer,
  avg_bruto numeric,
  min_bruto numeric,
  max_bruto numeric,
  stddev_bruto numeric,
  last_seen_month date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public','extensions'
AS $$
DECLARE
  v_hospital uuid := public.current_active_hospital();
BEGIN
  IF v_hospital IS NULL OR p_pattern_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH pat AS (
    SELECT id, label FROM public.payment_batch_patterns
    WHERE id = p_pattern_id AND hospital_id = v_hospital
  ),
  hist AS (
    SELECT date_trunc('month', p.competence_month)::date AS m,
           sum(p.bruto_total)::numeric AS bruto
    FROM public.payments p
    WHERE p.hospital_id = v_hospital
      AND p.batch_pattern_id = p_pattern_id
      AND p.competence_month >= (date_trunc('month', now()) - interval '12 months')::date
      AND p.status NOT IN ('rascunho','cancelado','rejeitado')
    GROUP BY 1
  )
  SELECT
    pat.id,
    pat.label,
    (SELECT count(*)::int FROM hist),
    (SELECT round(avg(bruto)::numeric, 2) FROM hist),
    (SELECT round(min(bruto)::numeric, 2) FROM hist),
    (SELECT round(max(bruto)::numeric, 2) FROM hist),
    (SELECT round(coalesce(stddev_pop(bruto),0)::numeric, 2) FROM hist),
    (SELECT max(m) FROM hist)
  FROM pat;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pattern_stats(uuid) TO authenticated;

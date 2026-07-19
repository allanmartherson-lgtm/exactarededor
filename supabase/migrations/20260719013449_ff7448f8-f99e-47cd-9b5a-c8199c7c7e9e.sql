-- Fase D: detecção de anomalias de valor por padrão de lote
CREATE OR REPLACE FUNCTION public.get_pattern_anomalies(
  p_threshold_pct numeric DEFAULT 25,
  p_min_months int DEFAULT 3
)
RETURNS TABLE (
  pattern_id uuid,
  pattern_label text,
  payment_id uuid,
  payment_reference text,
  competence_month date,
  current_bruto numeric,
  avg_bruto numeric,
  stddev_bruto numeric,
  months_seen int,
  delta_pct numeric,
  z_score numeric,
  severity text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hospital uuid := public.current_active_hospital();
BEGIN
  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (p.batch_pattern_id)
      p.batch_pattern_id AS pattern_id,
      p.id AS payment_id,
      COALESCE(p.reference, p.payment_reference, p.id::text) AS payment_reference,
      p.competence_month,
      COALESCE(p.bruto_total, 0)::numeric AS current_bruto
    FROM public.payments p
    WHERE p.hospital_id = v_hospital
      AND p.batch_pattern_id IS NOT NULL
      AND p.competence_month IS NOT NULL
    ORDER BY p.batch_pattern_id, p.competence_month DESC, p.created_at DESC
  ),
  hist AS (
    SELECT
      p.batch_pattern_id AS pattern_id,
      p.competence_month,
      SUM(COALESCE(p.bruto_total, 0))::numeric AS bruto
    FROM public.payments p
    WHERE p.hospital_id = v_hospital
      AND p.batch_pattern_id IS NOT NULL
      AND p.competence_month IS NOT NULL
    GROUP BY p.batch_pattern_id, p.competence_month
  ),
  stats AS (
    SELECT
      h.pattern_id,
      l.payment_id,
      l.payment_reference,
      l.competence_month,
      l.current_bruto,
      AVG(h.bruto) FILTER (WHERE h.competence_month < l.competence_month) AS avg_bruto,
      COALESCE(STDDEV_SAMP(h.bruto) FILTER (WHERE h.competence_month < l.competence_month), 0) AS stddev_bruto,
      COUNT(*) FILTER (WHERE h.competence_month < l.competence_month)::int AS months_seen
    FROM hist h
    JOIN latest l ON l.pattern_id = h.pattern_id
    GROUP BY h.pattern_id, l.payment_id, l.payment_reference, l.competence_month, l.current_bruto
  )
  SELECT
    s.pattern_id,
    bp.label AS pattern_label,
    s.payment_id,
    s.payment_reference,
    s.competence_month,
    s.current_bruto,
    s.avg_bruto,
    s.stddev_bruto,
    s.months_seen,
    CASE WHEN s.avg_bruto > 0 THEN ((s.current_bruto - s.avg_bruto) / s.avg_bruto) * 100 ELSE NULL END AS delta_pct,
    CASE WHEN s.stddev_bruto > 0 THEN (s.current_bruto - s.avg_bruto) / s.stddev_bruto ELSE NULL END AS z_score,
    CASE
      WHEN s.avg_bruto > 0 AND ABS((s.current_bruto - s.avg_bruto) / s.avg_bruto) * 100 >= 50 THEN 'alta'
      WHEN s.avg_bruto > 0 AND ABS((s.current_bruto - s.avg_bruto) / s.avg_bruto) * 100 >= p_threshold_pct THEN 'media'
      WHEN s.stddev_bruto > 0 AND ABS((s.current_bruto - s.avg_bruto) / s.stddev_bruto) >= 2 THEN 'media'
      ELSE 'baixa'
    END AS severity
  FROM stats s
  JOIN public.payment_batch_patterns bp ON bp.id = s.pattern_id
  WHERE bp.hospital_id = v_hospital
    AND s.months_seen >= p_min_months
    AND s.avg_bruto IS NOT NULL
    AND s.avg_bruto > 0
    AND (
      ABS((s.current_bruto - s.avg_bruto) / s.avg_bruto) * 100 >= p_threshold_pct
      OR (s.stddev_bruto > 0 AND ABS((s.current_bruto - s.avg_bruto) / s.stddev_bruto) >= 2)
    )
  ORDER BY ABS(COALESCE(((s.current_bruto - s.avg_bruto) / NULLIF(s.avg_bruto,0)) * 100, 0)) DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pattern_anomalies(numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pattern_anomalies(numeric, int) TO service_role;
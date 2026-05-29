
CREATE OR REPLACE FUNCTION public.get_dre_consolidated(
  p_competencia_from DATE DEFAULT NULL,
  p_competencia_to DATE DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_doctor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  competencia DATE, company_id UUID, company_name TEXT,
  doctor_id UUID, doctor_name TEXT,
  bruto NUMERIC, debitos NUMERIC, creditos NUMERIC,
  glosas NUMERIC, pool NUMERIC, liquido NUMERIC,
  payments_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date AS competencia,
      pcf.payment_id, pcf.company_id,
      pcf.bruto, pcf.debitos, pcf.creditos, pcf.glosas, pcf.pool
    FROM public.payment_company_financials pcf
    JOIN public.payments p ON p.id = pcf.payment_id
  )
  SELECT
    b.competencia, b.company_id, c.name,
    pi.doctor_id, d.full_name,
    COALESCE(SUM(b.bruto),0), COALESCE(SUM(b.debitos),0),
    COALESCE(SUM(b.creditos),0), COALESCE(SUM(b.glosas),0),
    COALESCE(SUM(b.pool),0),
    COALESCE(SUM(b.bruto - b.debitos + b.creditos - b.glosas + b.pool),0),
    COUNT(DISTINCT b.payment_id)
  FROM base b
  LEFT JOIN public.companies c ON c.id = b.company_id
  LEFT JOIN LATERAL (
    SELECT pi2.doctor_id FROM public.payment_items pi2 WHERE pi2.payment_id = b.payment_id LIMIT 1
  ) pi ON true
  LEFT JOIN public.doctors d ON d.id = pi.doctor_id
  WHERE (p_competencia_from IS NULL OR b.competencia >= p_competencia_from)
    AND (p_competencia_to   IS NULL OR b.competencia <= p_competencia_to)
    AND (p_company_id IS NULL OR b.company_id = p_company_id)
    AND (p_doctor_id  IS NULL OR pi.doctor_id = p_doctor_id)
  GROUP BY 1,2,3,4,5
  ORDER BY 1 DESC, 3, 5;
$$;
GRANT EXECUTE ON FUNCTION public.get_dre_consolidated(DATE,DATE,UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_open_position(p_company_id UUID DEFAULT NULL)
RETURNS TABLE (
  payment_id UUID, reference TEXT, status TEXT,
  company_id UUID, company_name TEXT, competencia DATE,
  bruto NUMERIC, liquido NUMERIC, age_days INTEGER, aging_bucket TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    p.id, p.reference, p.status::text,
    pcf.company_id, c.name,
    date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date,
    COALESCE(pcf.bruto,0),
    COALESCE(pcf.bruto - pcf.debitos + pcf.creditos - pcf.glosas + pcf.pool, 0),
    EXTRACT(DAY FROM (now() - p.created_at))::int,
    CASE
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 15 THEN '0-15'
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 30 THEN '16-30'
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 60 THEN '31-60'
      ELSE '60+'
    END
  FROM public.payments p
  LEFT JOIN public.payment_company_financials pcf ON pcf.payment_id = p.id
  LEFT JOIN public.companies c ON c.id = pcf.company_id
  WHERE p.status::text NOT IN ('pago','cancelado','rejeitado','arquivado')
    AND (p_company_id IS NULL OR pcf.company_id = p_company_id)
  ORDER BY 9 DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION public.get_open_position(UUID) TO authenticated;

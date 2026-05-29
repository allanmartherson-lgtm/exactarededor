
CREATE OR REPLACE FUNCTION public.get_dre_drilldown(
  p_competencia DATE,
  p_company_id UUID,
  p_doctor_id UUID DEFAULT NULL
)
RETURNS TABLE (
  payment_id UUID,
  reference TEXT,
  status TEXT,
  created_at TIMESTAMPTZ,
  bruto NUMERIC,
  debitos NUMERIC,
  creditos NUMERIC,
  glosas NUMERIC,
  pool NUMERIC,
  liquido NUMERIC,
  items_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.reference, p.status::TEXT, p.created_at,
    COALESCE(pcf.bruto, 0),
    COALESCE(pcf.debitos, 0),
    COALESCE((
      SELECT SUM(fj.valor) FROM financial_journal fj
      WHERE fj.payment_id = p.id AND fj.company_id = p_company_id AND fj.sinal = 1
        AND (p_doctor_id IS NULL OR fj.doctor_id = p_doctor_id)
    ), 0),
    COALESCE(pcf.glosas, 0),
    COALESCE((SELECT SUM((d->>'valor')::NUMERIC) FROM jsonb_array_elements(pcf.pool_detalhes) d), 0),
    COALESCE(pcf.liquido, 0),
    (SELECT COUNT(*) FROM payment_items pi WHERE pi.payment_id = p.id
      AND (p_doctor_id IS NULL OR pi.doctor_id = p_doctor_id))::BIGINT
  FROM payments p
  LEFT JOIN payment_company_financials pcf ON pcf.payment_id = p.id AND pcf.company_id = p_company_id
  WHERE p.competence_month = p_competencia
    AND EXISTS (
      SELECT 1 FROM payment_company_groups pcg
      WHERE pcg.payment_id = p.id AND pcg.company_id = p_company_id
    )
    AND (p_doctor_id IS NULL OR EXISTS (
      SELECT 1 FROM payment_items pi WHERE pi.payment_id = p.id AND pi.doctor_id = p_doctor_id
    ))
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dre_drilldown(DATE, UUID, UUID) TO authenticated;

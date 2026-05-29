
CREATE OR REPLACE FUNCTION public.get_stuck_companies(p_limit INT DEFAULT 10)
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  stuck_count BIGINT,
  total_stuck_value NUMERIC,
  max_age_days INT,
  worst_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stuck AS (
    SELECT pcg.company_id, pcg.status::TEXT AS status, COALESCE(pcg.liquido_total, pcg.total_amount, 0) AS val,
      EXTRACT(EPOCH FROM (now() - p.created_at))/86400 AS age_days
    FROM payment_company_groups pcg
    JOIN payments p ON p.id = pcg.payment_id
    WHERE pcg.status::TEXT NOT IN ('pago','rejeitado','cancelado','arquivado','nf_conciliada','lancado')
      AND p.created_at < now() - INTERVAL '7 days'
      AND pcg.company_id IS NOT NULL
  )
  SELECT c.id, c.name,
    COUNT(*)::BIGINT,
    COALESCE(SUM(s.val),0)::NUMERIC,
    MAX(s.age_days)::INT,
    (ARRAY_AGG(s.status ORDER BY s.age_days DESC))[1]
  FROM stuck s
  JOIN companies c ON c.id = s.company_id
  GROUP BY c.id, c.name
  ORDER BY MAX(s.age_days) DESC
  LIMIT p_limit;
END;
$$;

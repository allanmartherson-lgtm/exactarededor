
-- Saúde do Dinheiro: funnel, top PJs travadas, anomalias

-- 1) Funnel de pagamentos: agrupamento por estágio macro
CREATE OR REPLACE FUNCTION public.get_money_funnel(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
  stage TEXT,
  stage_order INT,
  payment_count BIGINT,
  total_value NUMERIC,
  avg_age_days NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stage_map AS (
    SELECT p.id, p.total_value, p.created_at,
      CASE
        WHEN p.status IN ('rascunho','em_analise_ia') THEN 'Em análise'
        WHEN p.status IN ('revisao_analista','devolvido_analista','concluida_analista') THEN 'Revisão analista'
        WHEN p.status IN ('aguardando_validacao') THEN 'Aguardando validação'
        WHEN p.status IN ('aguardando_aprovacao','aprovado_em_revisao','revisao_pos_aprovacao') THEN 'Aguardando aprovação'
        WHEN p.status IN ('aprovado','aprovado_com_ressalva','aprovado_parcial') THEN 'Aprovado'
        WHEN p.status IN ('pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente') THEN 'Ciclo NF'
        WHEN p.status IN ('nf_conciliada','lancado') THEN 'Conciliado'
        WHEN p.status = 'pago' THEN 'Pago'
        WHEN p.status IN ('rejeitado','cancelado','arquivado') THEN 'Encerrado'
        ELSE 'Outro'
      END AS s,
      CASE
        WHEN p.status IN ('rascunho','em_analise_ia') THEN 1
        WHEN p.status IN ('revisao_analista','devolvido_analista','concluida_analista') THEN 2
        WHEN p.status = 'aguardando_validacao' THEN 3
        WHEN p.status IN ('aguardando_aprovacao','aprovado_em_revisao','revisao_pos_aprovacao') THEN 4
        WHEN p.status IN ('aprovado','aprovado_com_ressalva','aprovado_parcial') THEN 5
        WHEN p.status IN ('pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente') THEN 6
        WHEN p.status IN ('nf_conciliada','lancado') THEN 7
        WHEN p.status = 'pago' THEN 8
        ELSE 9
      END AS s_order
    FROM payments p
    WHERE (p_start_date IS NULL OR p.created_at::date >= p_start_date)
      AND (p_end_date IS NULL OR p.created_at::date <= p_end_date)
  )
  SELECT s, MIN(s_order)::INT,
    COUNT(*)::BIGINT,
    COALESCE(SUM(total_value),0)::NUMERIC,
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - created_at))/86400)::NUMERIC, 1)
  FROM stage_map
  GROUP BY s
  ORDER BY MIN(s_order);
END;
$$;

-- 2) Top PJs travadas: empresas com payments parados há mais tempo
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
    SELECT pcg.company_id, pcg.status, pcg.subtotal_value,
      EXTRACT(EPOCH FROM (now() - p.created_at))/86400 AS age_days
    FROM payment_company_groups pcg
    JOIN payments p ON p.id = pcg.payment_id
    WHERE pcg.status NOT IN ('pago','rejeitado','cancelado','arquivado','nf_conciliada','lancado')
      AND p.created_at < now() - INTERVAL '7 days'
  )
  SELECT c.id, c.name,
    COUNT(*)::BIGINT,
    COALESCE(SUM(s.subtotal_value),0)::NUMERIC,
    MAX(s.age_days)::INT,
    (ARRAY_AGG(s.status ORDER BY s.age_days DESC))[1]
  FROM stuck s
  JOIN companies c ON c.id = s.company_id
  GROUP BY c.id, c.name
  ORDER BY MAX(s.age_days) DESC
  LIMIT p_limit;
END;
$$;

-- 3) Anomalias financeiras: outliers de valor, glosas spike, atrasos
CREATE OR REPLACE FUNCTION public.get_money_anomalies(p_days INT DEFAULT 30)
RETURNS TABLE (
  anomaly_type TEXT,
  severity TEXT,
  entity_id UUID,
  entity_name TEXT,
  metric_value NUMERIC,
  baseline_value NUMERIC,
  detected_at TIMESTAMPTZ,
  details JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  -- Outliers de valor por empresa (>2x média histórica)
  WITH company_avg AS (
    SELECT pcg.company_id, AVG(pcg.subtotal_value) AS avg_val, STDDEV(pcg.subtotal_value) AS sd_val
    FROM payment_company_groups pcg
    JOIN payments p ON p.id = pcg.payment_id
    WHERE p.created_at >= now() - INTERVAL '180 days'
    GROUP BY pcg.company_id
    HAVING COUNT(*) >= 3
  ),
  recent AS (
    SELECT pcg.company_id, pcg.subtotal_value, p.created_at, p.id AS payment_id
    FROM payment_company_groups pcg
    JOIN payments p ON p.id = pcg.payment_id
    WHERE p.created_at >= now() - (p_days || ' days')::interval
  )
  SELECT 'outlier_valor'::TEXT,
    CASE WHEN r.subtotal_value > ca.avg_val + 3*ca.sd_val THEN 'alta'
         WHEN r.subtotal_value > ca.avg_val + 2*ca.sd_val THEN 'media' ELSE 'baixa' END,
    c.id, c.name,
    r.subtotal_value, ca.avg_val,
    r.created_at,
    jsonb_build_object('payment_id', r.payment_id, 'stddev', ca.sd_val)
  FROM recent r
  JOIN company_avg ca ON ca.company_id = r.company_id
  JOIN companies c ON c.id = r.company_id
  WHERE r.subtotal_value > ca.avg_val + 2*ca.sd_val

  UNION ALL

  -- Spike de glosa: médicos com glosa total nos últimos 30d > 3x média 6m
  SELECT 'spike_glosa'::TEXT,
    CASE WHEN recent_glosa > 5*hist_avg THEN 'alta'
         WHEN recent_glosa > 3*hist_avg THEN 'media' ELSE 'baixa' END,
    d.id, d.name,
    recent_glosa, hist_avg,
    now(),
    jsonb_build_object('crm', d.crm)
  FROM (
    SELECT gi.doctor_id,
      SUM(CASE WHEN gb.created_at >= now() - (p_days || ' days')::interval THEN gi.glosa_value ELSE 0 END) AS recent_glosa,
      NULLIF(AVG(CASE WHEN gb.created_at >= now() - INTERVAL '180 days' AND gb.created_at < now() - (p_days || ' days')::interval THEN gi.glosa_value END),0) AS hist_avg
    FROM glosa_items gi
    JOIN glosa_batches gb ON gb.id = gi.batch_id
    WHERE gi.doctor_id IS NOT NULL
    GROUP BY gi.doctor_id
    HAVING SUM(CASE WHEN gb.created_at >= now() - (p_days || ' days')::interval THEN gi.glosa_value ELSE 0 END) > 0
  ) ag
  JOIN doctors d ON d.id = ag.doctor_id
  WHERE ag.hist_avg IS NOT NULL AND ag.recent_glosa > 3*ag.hist_avg

  ORDER BY 6 DESC
  LIMIT 50;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_money_funnel(DATE,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_stuck_companies(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_money_anomalies(INT) TO authenticated;

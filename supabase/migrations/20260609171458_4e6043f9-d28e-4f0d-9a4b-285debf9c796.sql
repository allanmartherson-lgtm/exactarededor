
-- Adiciona filtro p_track nas RPCs de DRE, Posição em Aberto, Drill-down, Tendência e Funil.
-- Quando NULL, comporta-se como antes (sem filtro). Quando 'prioritario'/'habitual',
-- restringe aos lotes cuja payment_track corresponde. Use 'nao_classificado' para lotes
-- sem trilha definida (payment_track IS NULL).

-- 1) get_dre_consolidated
CREATE OR REPLACE FUNCTION public.get_dre_consolidated(
  p_competencia_from date DEFAULT NULL,
  p_competencia_to date DEFAULT NULL,
  p_company_id uuid DEFAULT NULL,
  p_doctor_id uuid DEFAULT NULL,
  p_track text DEFAULT NULL
)
RETURNS TABLE(
  competencia date, company_id uuid, company_name text,
  doctor_id uuid, doctor_name text,
  bruto numeric, debitos numeric, creditos numeric, glosas numeric, pool numeric,
  liquido numeric, payments_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH fin AS (
    SELECT
      date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date AS competencia,
      pcf.company_id,
      COALESCE(SUM(pcf.bruto),0)    AS bruto,
      COALESCE(SUM(pcf.debitos),0)  AS debitos,
      COALESCE(SUM(pcf.creditos),0) AS creditos,
      COALESCE(SUM(pcf.glosas),0)   AS glosas,
      COALESCE(SUM(pcf.pool),0)     AS pool,
      COUNT(DISTINCT pcf.payment_id) AS payments_count
    FROM public.payment_company_financials pcf
    JOIN public.payments p ON p.id = pcf.payment_id
    WHERE (p_competencia_from IS NULL OR date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date >= p_competencia_from)
      AND (p_competencia_to   IS NULL OR date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date <= p_competencia_to)
      AND (p_company_id IS NULL OR pcf.company_id = p_company_id)
      AND (
        p_track IS NULL
        OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
        OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
      )
    GROUP BY 1, 2
  ),
  docs AS (
    SELECT
      date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date AS competencia,
      pi.company_id,
      COUNT(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL) AS n_docs,
      (array_agg(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL))[1] AS rep_doctor_id
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.company_id IS NOT NULL
      AND (
        p_track IS NULL
        OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
        OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
      )
    GROUP BY 1, 2
  )
  SELECT
    f.competencia,
    f.company_id,
    c.name AS company_name,
    CASE WHEN d.n_docs = 1 THEN d.rep_doctor_id ELSE NULL END AS doctor_id,
    CASE WHEN d.n_docs = 1 THEN (SELECT dd.full_name FROM public.doctors dd WHERE dd.id = d.rep_doctor_id)
         WHEN d.n_docs > 1 THEN 'Vários médicos'
         ELSE NULL END AS doctor_name,
    f.bruto, f.debitos, f.creditos, f.glosas, f.pool,
    (f.bruto - f.debitos + f.creditos - f.glosas + f.pool) AS liquido,
    f.payments_count
  FROM fin f
  LEFT JOIN public.companies c ON c.id = f.company_id
  LEFT JOIN docs d ON d.competencia = f.competencia AND d.company_id = f.company_id
  WHERE (p_doctor_id IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_items pi2
          JOIN public.payments p2 ON p2.id = pi2.payment_id
          WHERE pi2.company_id = f.company_id
            AND pi2.doctor_id = p_doctor_id
            AND date_trunc('month', COALESCE(p2.competence_month, p2.created_at::date))::date = f.competencia
        ))
  ORDER BY f.competencia DESC, c.name;
$function$;

GRANT EXECUTE ON FUNCTION public.get_dre_consolidated(date, date, uuid, uuid, text) TO authenticated;

-- 2) get_open_position
CREATE OR REPLACE FUNCTION public.get_open_position(
  p_company_id UUID DEFAULT NULL,
  p_track text DEFAULT NULL
)
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
    AND (
      p_track IS NULL
      OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
      OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
    )
  ORDER BY 9 DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_position(UUID, text) TO authenticated;

-- 3) get_dre_drilldown
CREATE OR REPLACE FUNCTION public.get_dre_drilldown(
  p_competencia DATE,
  p_company_id UUID,
  p_doctor_id UUID DEFAULT NULL,
  p_track text DEFAULT NULL
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
    AND (
      p_track IS NULL
      OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
      OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
    )
  ORDER BY p.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dre_drilldown(DATE, UUID, UUID, text) TO authenticated;

-- 4) get_spend_trend
CREATE OR REPLACE FUNCTION public.get_spend_trend(
  p_current_month date,
  p_months_back integer,
  p_grouping text,
  p_track text DEFAULT NULL
)
 RETURNS TABLE(group_key text, month_bucket date, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start date;
  v_end   date;
begin
  SET LOCAL statement_timeout = '30s';

  v_start := (date_trunc('month', p_current_month)::date) - ((greatest(p_months_back,1) - 1) || ' month')::interval;
  v_end   := (date_trunc('month', p_current_month)::date) + interval '1 month';

  return query
  with base as (
    select
      pi.gross_amount,
      pi.doctor_name,
      pi.company_name,
      p.cost_center_code,
      date_trunc('month', p.competence_month::date)::date as m,
      coalesce(
        nullif(btrim(pi.specialty), ''),
        (select (specialties)[1] from public.doctors d
           where lower(btrim(d.full_name)) = lower(btrim(pi.doctor_name)) limit 1),
        '(sem especialidade)'
      ) as especialidade
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    where p.competence_month is not null
      and p.competence_month::date >= v_start
      and p.competence_month::date <  v_end
      and (
        p_track is null
        or (p_track = 'nao_classificado' and p.payment_track is null)
        or (p_track in ('prioritario','habitual') and p.payment_track::text = p_track)
      )
  )
  select
    case p_grouping
      when 'especialidade' then especialidade
      when 'empresa'       then coalesce(company_name, '(sem empresa)')
      when 'medico'        then coalesce(doctor_name, '(sem médico)')
      when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
      else '(?)'
    end as group_key,
    m as month_bucket,
    sum(gross_amount)::numeric as total
  from base
  group by 1, 2;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.get_spend_trend(date, integer, text, text) TO authenticated, service_role;

-- 5) get_money_funnel
CREATE OR REPLACE FUNCTION public.get_money_funnel(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL,
  p_track text DEFAULT NULL
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
    SELECT p.id, COALESCE(p.liquido_total, p.total_amount, 0) AS val, p.created_at,
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
      AND (
        p_track IS NULL
        OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
        OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
      )
  )
  SELECT s, MIN(s_order)::INT,
    COUNT(*)::BIGINT,
    COALESCE(SUM(val),0)::NUMERIC,
    ROUND(AVG(EXTRACT(EPOCH FROM (now() - created_at))/86400)::NUMERIC, 1)
  FROM stage_map
  GROUP BY s
  ORDER BY MIN(s_order);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_money_funnel(DATE, DATE, text) TO authenticated;

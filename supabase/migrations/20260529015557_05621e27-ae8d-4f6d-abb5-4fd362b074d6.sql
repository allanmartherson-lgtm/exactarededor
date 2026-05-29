-- Onda 5: KPI Dashboard RPCs para portal do médico

CREATE OR REPLACE FUNCTION public.get_portal_dashboard_kpis(p_doctor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_12m_inicio date := date_trunc('month', now())::date - interval '11 months';
  v_mes_atual date := date_trunc('month', now())::date;
  v_recebido_12m numeric := 0;
  v_aprovado_12m numeric := 0;
  v_pendente_12m numeric := 0;
  v_glosa_12m numeric := 0;
  v_mes_corrente numeric := 0;
  v_qtd_itens_12m integer := 0;
  v_qtd_aprovados_12m integer := 0;
  v_ticket_medio numeric := 0;
  v_pct_aprovado numeric := 0;
  v_glosa_pendente numeric := 0;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN p.status::text = 'pago'
                      THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) END), 0),
    COALESCE(SUM(CASE WHEN pi.ai_status::text = 'aprovado'
                      THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) END), 0),
    COALESCE(SUM(CASE WHEN pi.ai_status::text NOT IN ('aprovado','reprovado')
                      THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE pi.ai_status::text = 'aprovado')
  INTO v_recebido_12m, v_aprovado_12m, v_pendente_12m, v_qtd_itens_12m, v_qtd_aprovados_12m
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.doctor_id = p_doctor_id
    AND p.competence_month >= v_12m_inicio;

  SELECT COALESCE(SUM(gpa.valor_aplicado), 0)
    INTO v_glosa_12m
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
   WHERE gpa.doctor_id = p_doctor_id
     AND gpa.status IN ('proposto','confirmado')
     AND p.competence_month >= v_12m_inicio;

  SELECT COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
    INTO v_mes_corrente
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month = v_mes_atual;

  SELECT COALESCE(SUM(total_debt), 0)
    INTO v_glosa_pendente
    FROM public.glosa_debts
   WHERE status = 'pendente'
     AND doctor_crm IN (
       SELECT crm FROM public.doctors WHERE id = p_doctor_id
     );

  IF v_qtd_itens_12m > 0 THEN
    v_ticket_medio := v_recebido_12m / NULLIF(v_qtd_aprovados_12m, 0);
    v_pct_aprovado := (v_qtd_aprovados_12m::numeric / v_qtd_itens_12m) * 100;
  END IF;

  RETURN jsonb_build_object(
    'recebido_12m', v_recebido_12m,
    'aprovado_12m', v_aprovado_12m,
    'pendente_12m', v_pendente_12m,
    'glosa_12m', v_glosa_12m,
    'mes_corrente', v_mes_corrente,
    'ticket_medio', COALESCE(v_ticket_medio, 0),
    'pct_aprovado', v_pct_aprovado,
    'qtd_itens_12m', v_qtd_itens_12m,
    'glosa_pendente', v_glosa_pendente
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portal_payment_trend(p_doctor_id uuid, p_months integer DEFAULT 12)
RETURNS TABLE(competence_month date, bruto numeric, aprovado numeric, pago numeric, glosa numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inicio date;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_inicio := date_trunc('month', now())::date - ((p_months - 1) || ' months')::interval;

  RETURN QUERY
  WITH meses AS (
    SELECT generate_series(v_inicio, date_trunc('month', now())::date, interval '1 month')::date AS mes
  ),
  itens AS (
    SELECT p.competence_month AS mes,
           COALESCE(pi.gross_amount, 0) AS bruto,
           CASE WHEN pi.ai_status::text = 'aprovado' THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) ELSE 0 END AS aprovado,
           CASE WHEN p.status::text = 'pago' THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) ELSE 0 END AS pago
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.doctor_id = p_doctor_id
      AND p.competence_month >= v_inicio
  ),
  glosas AS (
    SELECT p.competence_month AS mes, COALESCE(SUM(gpa.valor_aplicado), 0) AS glosa
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
    WHERE gpa.doctor_id = p_doctor_id
      AND gpa.status IN ('proposto','confirmado')
      AND p.competence_month >= v_inicio
    GROUP BY p.competence_month
  )
  SELECT m.mes,
         COALESCE(SUM(i.bruto), 0),
         COALESCE(SUM(i.aprovado), 0),
         COALESCE(SUM(i.pago), 0),
         COALESCE(MAX(g.glosa), 0)
  FROM meses m
  LEFT JOIN itens i ON i.mes = m.mes
  LEFT JOIN glosas g ON g.mes = m.mes
  GROUP BY m.mes
  ORDER BY m.mes;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portal_top_procedures(p_doctor_id uuid, p_months integer DEFAULT 12, p_limit integer DEFAULT 10)
RETURNS TABLE(procedure_code text, procedure_name text, quantidade bigint, valor_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inicio date;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_inicio := date_trunc('month', now())::date - ((p_months - 1) || ' months')::interval;

  RETURN QUERY
  SELECT pi.procedure_code,
         MAX(pi.procedure_name),
         COUNT(*)::bigint,
         COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.doctor_id = p_doctor_id
    AND p.competence_month >= v_inicio
    AND pi.procedure_code IS NOT NULL
  GROUP BY pi.procedure_code
  ORDER BY valor_total DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portal_company_breakdown(p_doctor_id uuid, p_months integer DEFAULT 12)
RETURNS TABLE(company_id uuid, company_name text, quantidade bigint, valor_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_inicio date;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_inicio := date_trunc('month', now())::date - ((p_months - 1) || ' months')::interval;

  RETURN QUERY
  SELECT pi.company_id,
         COALESCE(MAX(c.name), MAX(pi.company_name)),
         COUNT(*)::bigint,
         COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  LEFT JOIN public.companies c ON c.id = pi.company_id
  WHERE pi.doctor_id = p_doctor_id
    AND p.competence_month >= v_inicio
  GROUP BY pi.company_id
  ORDER BY valor_total DESC;
END;
$$;
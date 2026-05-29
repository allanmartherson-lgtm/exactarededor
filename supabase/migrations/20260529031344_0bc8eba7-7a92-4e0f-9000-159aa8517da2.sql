-- get_doctor_statement (novo) — 6 campos separados
CREATE OR REPLACE FUNCTION public.get_doctor_statement(
  p_doctor_id uuid,
  p_competence_month date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_producao_bruta numeric := 0;
  v_repasse_esperado numeric := 0;
  v_glosas numeric := 0;
  v_debitos numeric := 0;
  v_por_pj jsonb;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(SUM(pi.gross_amount), 0),
    COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
    INTO v_producao_bruta, v_repasse_esperado
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.doctor_id = p_doctor_id
    AND (p_competence_month IS NULL OR p.competence_month = p_competence_month);

  SELECT COALESCE(SUM(gpa.valor_aplicado), 0)
    INTO v_glosas
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
   WHERE gpa.doctor_id = p_doctor_id
     AND gpa.status IN ('proposto','confirmado')
     AND (p_competence_month IS NULL OR p.competence_month = p_competence_month);

  v_debitos := v_glosas;

  WITH itens_pj AS (
    SELECT
      pi.company_id,
      MAX(pi.company_name) AS company_name,
      COALESCE(SUM(pi.gross_amount), 0) AS producao_bruta,
      COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0) AS repasse_esperado
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.doctor_id = p_doctor_id
      AND (p_competence_month IS NULL OR p.competence_month = p_competence_month)
    GROUP BY pi.company_id
  ),
  glosas_pj AS (
    SELECT
      gpa.company_id,
      COALESCE(SUM(gpa.valor_aplicado), 0) AS debitos_compensados
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
    WHERE gpa.doctor_id = p_doctor_id
      AND gpa.status IN ('proposto','confirmado')
      AND (p_competence_month IS NULL OR p.competence_month = p_competence_month)
    GROUP BY gpa.company_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'company_id', i.company_id,
    'company_name', i.company_name,
    'producao_bruta', i.producao_bruta,
    'repasse_esperado', i.repasse_esperado,
    'debitos_compensados', COALESCE(g.debitos_compensados, 0),
    'liquido', i.repasse_esperado - COALESCE(g.debitos_compensados, 0)
  ) ORDER BY i.repasse_esperado DESC), '[]'::jsonb)
    INTO v_por_pj
    FROM itens_pj i
    LEFT JOIN glosas_pj g ON g.company_id = i.company_id;

  RETURN jsonb_build_object(
    'doctor_id', p_doctor_id,
    'competence_month', p_competence_month,
    'producao_bruta', v_producao_bruta,
    'repasse_esperado', v_repasse_esperado,
    'glosas', v_glosas,
    'debitos_compensados', v_debitos,
    'liquido', v_repasse_esperado - v_debitos,
    'por_pj', v_por_pj
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_doctor_statement(uuid, date) TO authenticated;

-- get_portal_competencias — adicionar itens_sem_regra (DROP necessário por mudar tipo de retorno)
DROP FUNCTION IF EXISTS public.get_portal_competencias(uuid, int);

CREATE OR REPLACE FUNCTION public.get_portal_competencias(
  p_doctor_id uuid,
  p_limit int DEFAULT 24
)
RETURNS TABLE (
  competence_month date,
  bruto numeric,
  esperado numeric,
  glosas numeric,
  liquido_estimado numeric,
  itens_count int,
  itens_sem_regra int,
  status_agregado text,
  payment_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      p.competence_month,
      p.id AS payment_id,
      p.status::text AS pstatus,
      COALESCE(SUM(pi.gross_amount), 0) AS bruto,
      COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0) AS esperado,
      COUNT(*)::int AS itens,
      COUNT(*) FILTER (WHERE pi.applied_rule_id IS NULL)::int AS sem_regra
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.doctor_id = p_doctor_id
      AND p.competence_month IS NOT NULL
    GROUP BY p.competence_month, p.id, p.status
  ),
  glosa_comp AS (
    SELECT p.competence_month, COALESCE(SUM(gpa.valor_aplicado), 0) AS glosas
      FROM public.glosa_payment_applications gpa
      JOIN public.payments p ON p.id = gpa.payment_id
     WHERE gpa.doctor_id = p_doctor_id
       AND gpa.status IN ('proposto','confirmado')
     GROUP BY p.competence_month
  )
  SELECT
    b.competence_month,
    SUM(b.bruto)::numeric,
    SUM(b.esperado)::numeric,
    COALESCE(MAX(gc.glosas), 0)::numeric,
    (SUM(b.esperado) - COALESCE(MAX(gc.glosas), 0))::numeric,
    SUM(b.itens)::int,
    SUM(b.sem_regra)::int,
    CASE
      WHEN bool_or(b.pstatus = 'pago') AND NOT bool_or(b.pstatus NOT IN ('pago')) THEN 'pago'
      WHEN bool_or(b.pstatus LIKE 'nf_%' OR b.pstatus LIKE 'pedido_nf%') THEN 'em_nf'
      WHEN bool_or(b.pstatus IN ('aprovado','aprovado_com_ressalva','aprovado_parcial','aprovado_em_revisao')) THEN 'aprovado'
      WHEN bool_or(b.pstatus IN ('rejeitado','cancelado')) THEN 'rejeitado'
      ELSE 'em_analise'
    END,
    array_agg(DISTINCT b.payment_id)
  FROM base b
  LEFT JOIN glosa_comp gc ON gc.competence_month = b.competence_month
  GROUP BY b.competence_month
  ORDER BY b.competence_month DESC
  LIMIT p_limit;
END;
$$;
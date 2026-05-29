
-- =========================================================
-- Portal do Médico — RPCs Onda 1
-- =========================================================

-- Helper: verifica se o auth.uid() tem acesso ao doctor_id
CREATE OR REPLACE FUNCTION public.portal_can_access_doctor(p_doctor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.doctor_portal_users dpu
      WHERE dpu.doctor_id = p_doctor_id
        AND dpu.user_id = auth.uid()
        AND dpu.active = true
    )
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role);
$$;

-- Helper: resolve doctor_id do usuário do portal logado
CREATE OR REPLACE FUNCTION public.portal_current_doctor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT doctor_id
    FROM public.doctor_portal_users
   WHERE user_id = auth.uid()
     AND active = true
   ORDER BY accepted_at NULLS LAST, invited_at DESC
   LIMIT 1;
$$;

-- =========================================================
-- 1) Resumo da home
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_portal_home(p_doctor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_aprovado numeric := 0;
  v_total_pendente numeric := 0;
  v_ultima_comp_paga date;
  v_ultimo_pgto numeric := 0;
  v_ultima_comp date;
  v_liquido_ultima numeric := 0;
  v_glosas_ultima numeric := 0;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- aprovado / pendente (geral, todos os tempos)
  SELECT
    COALESCE(SUM(CASE WHEN pi.ai_status::text = 'aprovado'
                      THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) END), 0),
    COALESCE(SUM(CASE WHEN pi.ai_status::text NOT IN ('aprovado','reprovado')
                      THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) END), 0)
    INTO v_total_aprovado, v_total_pendente
  FROM public.payment_items pi
  WHERE pi.doctor_id = p_doctor_id;

  -- última competência paga
  SELECT p.competence_month
    INTO v_ultima_comp_paga
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.status::text = 'pago'
   ORDER BY p.competence_month DESC NULLS LAST
   LIMIT 1;

  IF v_ultima_comp_paga IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
      INTO v_ultimo_pgto
      FROM public.payment_items pi
      JOIN public.payments p ON p.id = pi.payment_id
     WHERE pi.doctor_id = p_doctor_id
       AND p.status::text = 'pago'
       AND p.competence_month = v_ultima_comp_paga;
  END IF;

  -- última competência (qualquer status) → líquido estimado
  SELECT p.competence_month
    INTO v_ultima_comp
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month IS NOT NULL
   ORDER BY p.competence_month DESC
   LIMIT 1;

  IF v_ultima_comp IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
      INTO v_liquido_ultima
      FROM public.payment_items pi
      JOIN public.payments p ON p.id = pi.payment_id
     WHERE pi.doctor_id = p_doctor_id
       AND p.competence_month = v_ultima_comp;

    SELECT COALESCE(SUM(gpa.valor_aplicado), 0)
      INTO v_glosas_ultima
      FROM public.glosa_payment_applications gpa
      JOIN public.payments p ON p.id = gpa.payment_id
     WHERE gpa.doctor_id = p_doctor_id
       AND gpa.status IN ('proposto','confirmado')
       AND p.competence_month = v_ultima_comp;

    v_liquido_ultima := v_liquido_ultima - v_glosas_ultima;
  END IF;

  RETURN jsonb_build_object(
    'total_aprovado', v_total_aprovado,
    'total_pendente', v_total_pendente,
    'ultima_comp_paga', v_ultima_comp_paga,
    'ultimo_pgto_valor', v_ultimo_pgto,
    'ultima_competencia', v_ultima_comp,
    'liquido_ultima_competencia', v_liquido_ultima,
    'glosas_ultima_competencia', v_glosas_ultima
  );
END;
$$;

-- =========================================================
-- 2) Lista de competências
-- =========================================================
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
      COUNT(*)::int AS itens
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
    SUM(b.bruto)::numeric AS bruto,
    SUM(b.esperado)::numeric AS esperado,
    COALESCE(MAX(gc.glosas), 0)::numeric AS glosas,
    (SUM(b.esperado) - COALESCE(MAX(gc.glosas), 0))::numeric AS liquido_estimado,
    SUM(b.itens)::int AS itens_count,
    -- status agregado: pior caso entre pagamentos da competência
    CASE
      WHEN bool_or(b.pstatus = 'pago') AND NOT bool_or(b.pstatus NOT IN ('pago')) THEN 'pago'
      WHEN bool_or(b.pstatus LIKE 'nf_%' OR b.pstatus LIKE 'pedido_nf%') THEN 'em_nf'
      WHEN bool_or(b.pstatus IN ('aprovado','aprovado_com_ressalva','aprovado_parcial','aprovado_em_revisao')) THEN 'aprovado'
      WHEN bool_or(b.pstatus IN ('rejeitado','cancelado')) THEN 'rejeitado'
      ELSE 'em_analise'
    END AS status_agregado,
    array_agg(DISTINCT b.payment_id) AS payment_ids
  FROM base b
  LEFT JOIN glosa_comp gc ON gc.competence_month = b.competence_month
  GROUP BY b.competence_month
  ORDER BY b.competence_month DESC
  LIMIT p_limit;
END;
$$;

-- =========================================================
-- 3) Detalhe de uma competência
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_portal_competencia_detail(
  p_doctor_id uuid,
  p_competencia date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bruto numeric := 0;
  v_esperado numeric := 0;
  v_glosas numeric := 0;
  v_itens jsonb;
  v_glosa_breakdown jsonb;
  v_payments jsonb;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT
    COALESCE(SUM(pi.gross_amount), 0),
    COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
    INTO v_bruto, v_esperado
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.doctor_id = p_doctor_id
    AND p.competence_month = p_competencia;

  SELECT COALESCE(SUM(gpa.valor_aplicado), 0)
    INTO v_glosas
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
   WHERE gpa.doctor_id = p_doctor_id
     AND gpa.status IN ('proposto','confirmado')
     AND p.competence_month = p_competencia;

  SELECT jsonb_agg(jsonb_build_object(
    'id', pi.id,
    'payment_id', pi.payment_id,
    'procedure_code', pi.procedure_code,
    'procedure_name', pi.procedure_name,
    'procedure_date', pi.procedure_date,
    'patient_name', pi.patient_name,
    'company_name', pi.company_name,
    'sector', pi.sector,
    'gross_amount', pi.gross_amount,
    'expected_amount', pi.expected_amount,
    'ai_status', pi.ai_status,
    'payment_status', p.status,
    'reference', p.reference
  ) ORDER BY pi.procedure_date DESC NULLS LAST)
    INTO v_itens
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month = p_competencia;

  SELECT jsonb_agg(jsonb_build_object(
    'parcela_numero', gpa.parcela_numero,
    'valor_aplicado', gpa.valor_aplicado,
    'status', gpa.status,
    'company_id', gpa.company_id,
    'applied_at', gpa.applied_at,
    'glosa_debt_id', gpa.glosa_debt_id
  ))
    INTO v_glosa_breakdown
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
   WHERE gpa.doctor_id = p_doctor_id
     AND gpa.status IN ('proposto','confirmado')
     AND p.competence_month = p_competencia;

  SELECT jsonb_agg(DISTINCT jsonb_build_object(
    'id', p.id,
    'reference', p.reference,
    'status', p.status,
    'approved_at', p.approved_at
  ))
    INTO v_payments
    FROM public.payments p
    JOIN public.payment_items pi ON pi.payment_id = p.id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month = p_competencia;

  RETURN jsonb_build_object(
    'competencia', p_competencia,
    'bruto', v_bruto,
    'esperado', v_esperado,
    'glosas', v_glosas,
    'liquido_estimado', v_esperado - v_glosas,
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'glosa_breakdown', COALESCE(v_glosa_breakdown, '[]'::jsonb),
    'payments', COALESCE(v_payments, '[]'::jsonb)
  );
END;
$$;

-- =========================================================
-- 4) Débitos de glosa do médico
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_portal_doctor_debts(p_doctor_id uuid)
RETURNS TABLE (
  id uuid,
  doctor_crm text,
  doctor_name text,
  company_id uuid,
  total_debt numeric,
  total_aplicado numeric,
  saldo numeric,
  parcelas_default int,
  status text,
  resolution_status text,
  last_applied_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doctor_crm text;
  v_doctor_name text;
BEGIN
  IF NOT public.portal_can_access_doctor(p_doctor_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT d.crm, d.full_name INTO v_doctor_crm, v_doctor_name
    FROM public.doctors d WHERE d.id = p_doctor_id;

  RETURN QUERY
  SELECT
    gd.id,
    gd.doctor_crm,
    gd.doctor_name,
    gd.company_id,
    gd.total_debt,
    COALESCE((
      SELECT SUM(gpa.valor_aplicado)
        FROM public.glosa_payment_applications gpa
       WHERE gpa.glosa_debt_id = gd.id
         AND gpa.status IN ('proposto','confirmado')
    ), 0) AS total_aplicado,
    (gd.total_debt - COALESCE((
      SELECT SUM(gpa.valor_aplicado)
        FROM public.glosa_payment_applications gpa
       WHERE gpa.glosa_debt_id = gd.id
         AND gpa.status IN ('proposto','confirmado')
    ), 0)) AS saldo,
    gd.parcelas_default,
    gd.status,
    gd.resolution_status,
    gd.last_applied_at,
    gd.created_at
  FROM public.glosa_debts gd
  WHERE gd.status = 'ativo'
    AND (
      (v_doctor_crm IS NOT NULL AND gd.doctor_crm = v_doctor_crm)
      OR (v_doctor_name IS NOT NULL AND lower(gd.doctor_name) = lower(v_doctor_name))
    )
  ORDER BY gd.created_at DESC;
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION public.portal_can_access_doctor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_current_doctor_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_home(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_competencias(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_competencia_detail(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_portal_doctor_debts(uuid) TO authenticated;

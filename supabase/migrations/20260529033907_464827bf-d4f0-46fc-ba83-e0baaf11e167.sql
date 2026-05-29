-- ============================================================
-- Gate: portal do médico só vê pagamentos liberados via pedido de NF
-- Regra: EXISTS invoice com sent_at IS NOT NULL e status != 'cancelada'
-- Quando aplicável, também restringe pelo company_id do item (cada PJ
-- só aparece após o pedido de NF dela ter sido disparado).
-- ============================================================

-- 1) get_portal_competencias
CREATE OR REPLACE FUNCTION public.get_portal_competencias(p_doctor_id uuid, p_limit integer DEFAULT 24)
 RETURNS TABLE(competence_month date, bruto numeric, esperado numeric, glosas numeric, liquido_estimado numeric, itens_count integer, itens_sem_regra integer, status_agregado text, payment_ids uuid[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND EXISTS (
        SELECT 1 FROM public.invoices inv
        WHERE inv.payment_id = p.id
          AND inv.company_id = pi.company_id
          AND inv.sent_at IS NOT NULL
          AND inv.status::text <> 'cancelada'
      )
    GROUP BY p.competence_month, p.id, p.status
  ),
  glosa_comp AS (
    SELECT p.competence_month, COALESCE(SUM(gpa.valor_aplicado), 0) AS glosas
      FROM public.glosa_payment_applications gpa
      JOIN public.payments p ON p.id = gpa.payment_id
     WHERE gpa.doctor_id = p_doctor_id
       AND gpa.status IN ('proposto','confirmado')
       AND EXISTS (
         SELECT 1 FROM public.invoices inv
         WHERE inv.payment_id = p.id
           AND inv.company_id = gpa.company_id
           AND inv.sent_at IS NOT NULL
           AND inv.status::text <> 'cancelada'
       )
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
$function$;

-- 2) get_portal_home
CREATE OR REPLACE FUNCTION public.get_portal_home(p_doctor_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT
    COALESCE(SUM(CASE WHEN pi.ai_status::text = 'aprovado'
                      THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) END), 0),
    COALESCE(SUM(CASE WHEN pi.ai_status::text NOT IN ('aprovado','reprovado')
                      THEN COALESCE(pi.expected_amount, pi.gross_amount, 0) END), 0)
    INTO v_total_aprovado, v_total_pendente
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.doctor_id = p_doctor_id
    AND EXISTS (
      SELECT 1 FROM public.invoices inv
      WHERE inv.payment_id = p.id
        AND inv.company_id = pi.company_id
        AND inv.sent_at IS NOT NULL
        AND inv.status::text <> 'cancelada'
    );

  SELECT p.competence_month
    INTO v_ultima_comp_paga
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.status::text = 'pago'
     AND EXISTS (
       SELECT 1 FROM public.invoices inv
       WHERE inv.payment_id = p.id
         AND inv.company_id = pi.company_id
         AND inv.sent_at IS NOT NULL
         AND inv.status::text <> 'cancelada'
     )
   ORDER BY p.competence_month DESC NULLS LAST
   LIMIT 1;

  IF v_ultima_comp_paga IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
      INTO v_ultimo_pgto
      FROM public.payment_items pi
      JOIN public.payments p ON p.id = pi.payment_id
     WHERE pi.doctor_id = p_doctor_id
       AND p.status::text = 'pago'
       AND p.competence_month = v_ultima_comp_paga
       AND EXISTS (
         SELECT 1 FROM public.invoices inv
         WHERE inv.payment_id = p.id
           AND inv.company_id = pi.company_id
           AND inv.sent_at IS NOT NULL
           AND inv.status::text <> 'cancelada'
       );
  END IF;

  SELECT p.competence_month
    INTO v_ultima_comp
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.invoices inv
       WHERE inv.payment_id = p.id
         AND inv.company_id = pi.company_id
         AND inv.sent_at IS NOT NULL
         AND inv.status::text <> 'cancelada'
     )
   ORDER BY p.competence_month DESC
   LIMIT 1;

  IF v_ultima_comp IS NOT NULL THEN
    SELECT COALESCE(SUM(COALESCE(pi.expected_amount, pi.gross_amount, 0)), 0)
      INTO v_liquido_ultima
      FROM public.payment_items pi
      JOIN public.payments p ON p.id = pi.payment_id
     WHERE pi.doctor_id = p_doctor_id
       AND p.competence_month = v_ultima_comp
       AND EXISTS (
         SELECT 1 FROM public.invoices inv
         WHERE inv.payment_id = p.id
           AND inv.company_id = pi.company_id
           AND inv.sent_at IS NOT NULL
           AND inv.status::text <> 'cancelada'
       );

    SELECT COALESCE(SUM(gpa.valor_aplicado), 0)
      INTO v_glosas_ultima
      FROM public.glosa_payment_applications gpa
      JOIN public.payments p ON p.id = gpa.payment_id
     WHERE gpa.doctor_id = p_doctor_id
       AND gpa.status IN ('proposto','confirmado')
       AND p.competence_month = v_ultima_comp
       AND EXISTS (
         SELECT 1 FROM public.invoices inv
         WHERE inv.payment_id = p.id
           AND inv.company_id = gpa.company_id
           AND inv.sent_at IS NOT NULL
           AND inv.status::text <> 'cancelada'
       );

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
$function$;

-- 3) get_doctor_statement
CREATE OR REPLACE FUNCTION public.get_doctor_statement(p_doctor_id uuid, p_competence_month date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND (p_competence_month IS NULL OR p.competence_month = p_competence_month)
    AND EXISTS (
      SELECT 1 FROM public.invoices inv
      WHERE inv.payment_id = p.id
        AND inv.company_id = pi.company_id
        AND inv.sent_at IS NOT NULL
        AND inv.status::text <> 'cancelada'
    );

  SELECT COALESCE(SUM(gpa.valor_aplicado), 0)
    INTO v_glosas
    FROM public.glosa_payment_applications gpa
    JOIN public.payments p ON p.id = gpa.payment_id
   WHERE gpa.doctor_id = p_doctor_id
     AND gpa.status IN ('proposto','confirmado')
     AND (p_competence_month IS NULL OR p.competence_month = p_competence_month)
     AND EXISTS (
       SELECT 1 FROM public.invoices inv
       WHERE inv.payment_id = p.id
         AND inv.company_id = gpa.company_id
         AND inv.sent_at IS NOT NULL
         AND inv.status::text <> 'cancelada'
     );

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
      AND EXISTS (
        SELECT 1 FROM public.invoices inv
        WHERE inv.payment_id = p.id
          AND inv.company_id = pi.company_id
          AND inv.sent_at IS NOT NULL
          AND inv.status::text <> 'cancelada'
      )
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
      AND EXISTS (
        SELECT 1 FROM public.invoices inv
        WHERE inv.payment_id = p.id
          AND inv.company_id = gpa.company_id
          AND inv.sent_at IS NOT NULL
          AND inv.status::text <> 'cancelada'
      )
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
$function$;

-- 4) get_portal_company_breakdown
CREATE OR REPLACE FUNCTION public.get_portal_company_breakdown(p_doctor_id uuid, p_months integer DEFAULT 12)
 RETURNS TABLE(company_id uuid, company_name text, quantidade bigint, valor_total numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND EXISTS (
      SELECT 1 FROM public.invoices inv
      WHERE inv.payment_id = p.id
        AND inv.company_id = pi.company_id
        AND inv.sent_at IS NOT NULL
        AND inv.status::text <> 'cancelada'
    )
  GROUP BY pi.company_id
  ORDER BY valor_total DESC;
END;
$function$;

-- 5) get_portal_item_detail
CREATE OR REPLACE FUNCTION public.get_portal_item_detail(p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_rule RECORD;
  v_released boolean;
BEGIN
  SELECT pi.*, p.status AS payment_status, p.competence_month, p.reference AS payment_reference
    INTO v_item
  FROM payment_items pi
  JOIN payments p ON p.id = pi.payment_id
  WHERE pi.id = p_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item não encontrado';
  END IF;

  IF NOT public.portal_can_access_doctor(v_item.doctor_id) THEN
    RAISE EXCEPTION 'Sem permissão para acessar este item';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.invoices inv
    WHERE inv.payment_id = v_item.payment_id
      AND inv.company_id = v_item.company_id
      AND inv.sent_at IS NOT NULL
      AND inv.status::text <> 'cancelada'
  ) INTO v_released;

  IF NOT v_released THEN
    RAISE EXCEPTION 'Item ainda não liberado: pedido de NF não enviado';
  END IF;

  IF v_item.applied_rule_id IS NOT NULL THEN
    SELECT id, name, description, calculation_type, scope, severity, rule_text
      INTO v_rule
    FROM rules
    WHERE id = v_item.applied_rule_id;
  END IF;

  RETURN jsonb_build_object(
    'item', jsonb_build_object(
      'id', v_item.id,
      'payment_id', v_item.payment_id,
      'payment_reference', v_item.payment_reference,
      'payment_status', v_item.payment_status,
      'competence_month', v_item.competence_month,
      'company_name', v_item.company_name,
      'attendance_number', v_item.attendance_number,
      'procedure_code', v_item.procedure_code,
      'procedure_name', v_item.procedure_name,
      'procedure_date', v_item.procedure_date,
      'description', v_item.description,
      'tipo_item', v_item.tipo_item,
      'tipo_linha', v_item.tipo_linha,
      'sector', v_item.sector,
      'specialty', v_item.specialty,
      'access_route', v_item.access_route,
      'doctor_role', v_item.doctor_role,
      'agreement_text', v_item.agreement_text,
      'gross_amount', v_item.gross_amount,
      'procedure_amount', v_item.procedure_amount,
      'expected_amount', v_item.expected_amount,
      'quantity', v_item.quantity,
      'ai_status', v_item.ai_status,
      'patient_name', v_item.patient_name
    ),
    'alerts', COALESCE(v_item.ai_findings, '[]'::jsonb),
    'validation_findings', COALESCE(v_item.validation_findings, '[]'::jsonb),
    'applied_rule', CASE
      WHEN v_rule.id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_rule.id,
        'name', v_rule.name,
        'description', v_rule.description,
        'rule_type', v_rule.calculation_type,
        'scope', v_rule.scope,
        'severity', v_rule.severity,
        'rule_text', v_rule.rule_text,
        'applied_label', v_item.applied_rule_label,
        'applied_calc_method', v_item.applied_calc_method,
        'applied_at', v_item.applied_at
      )
    END,
    'exception', CASE
      WHEN COALESCE(v_item.authorized_exception, false) = false THEN NULL
      ELSE jsonb_build_object(
        'authorized', true,
        'reason', v_item.exception_reason,
        'note', v_item.exception_note,
        'authorizer', v_item.exception_authorizer,
        'marked_at', v_item.exception_marked_at
      )
    END
  );
END;
$function$;
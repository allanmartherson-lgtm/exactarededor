-- Portal RPCs: remover histórico/análises (timeline, ai_status, alerts, validation_findings)
-- Esses dados ficam apenas no Exacta (uso interno). Médico e empresa não devem ver.

DROP FUNCTION IF EXISTS public.get_portal_payment_timeline(uuid);

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
      'patient_name', v_item.patient_name,
      'empresa_tem_pool', COALESCE(v_item.empresa_tem_pool, false),
      'empresa_liquido_total', CASE WHEN COALESCE(v_item.empresa_tem_pool, false) THEN v_item.empresa_liquido_total ELSE NULL END,
      'rateio', CASE WHEN COALESCE(v_item.empresa_tem_pool, false) THEN v_item.rateio ELSE NULL END
    ),
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

CREATE OR REPLACE FUNCTION public.get_portal_competencia_detail(p_doctor_id uuid, p_competencia date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bruto numeric := 0;
  v_esperado numeric := 0;
  v_glosas numeric := 0;
  v_itens jsonb;
  v_glosa_breakdown jsonb;
  v_payments jsonb;
  v_empresa_tem_pool boolean := false;
  v_empresa_liquido_total numeric;
  v_rateio_itens jsonb;
  v_rateio_quota jsonb;
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
    'payment_status', p.status,
    'reference', p.reference,
    'empresa_tem_pool', COALESCE(pi.empresa_tem_pool, false),
    'empresa_liquido_total', pi.empresa_liquido_total,
    'rateio', pi.rateio
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

  SELECT bool_or(COALESCE(pi.empresa_tem_pool, false))
    INTO v_empresa_tem_pool
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
   WHERE pi.doctor_id = p_doctor_id
     AND p.competence_month = p_competencia;

  IF COALESCE(v_empresa_tem_pool, false) THEN
    SELECT MAX(pi.empresa_liquido_total)
      INTO v_empresa_liquido_total
      FROM public.payment_items pi
      JOIN public.payments p ON p.id = pi.payment_id
     WHERE pi.doctor_id = p_doctor_id
       AND p.competence_month = p_competencia
       AND COALESCE(pi.empresa_tem_pool, false) = true;

    WITH origin AS (
      SELECT DISTINCT ON (elem->>'id') elem
        FROM public.payment_items pi
        JOIN public.payments p ON p.id = pi.payment_id,
             LATERAL jsonb_array_elements(COALESCE(pi.rateio->'itens', '[]'::jsonb)) AS elem
       WHERE pi.doctor_id = p_doctor_id
         AND p.competence_month = p_competencia
         AND COALESCE(pi.empresa_tem_pool, false) = true
    )
    SELECT COALESCE(jsonb_agg(elem ORDER BY elem->>'data' DESC NULLS LAST), '[]'::jsonb)
      INTO v_rateio_itens
      FROM origin;

    WITH quotas AS (
      SELECT DISTINCT pi.rateio->'quota' AS q
        FROM public.payment_items pi
        JOIN public.payments p ON p.id = pi.payment_id
       WHERE pi.doctor_id = p_doctor_id
         AND p.competence_month = p_competencia
         AND COALESCE(pi.empresa_tem_pool, false) = true
         AND pi.rateio ? 'quota'
         AND pi.rateio->'quota' IS NOT NULL
    )
    SELECT CASE
      WHEN COUNT(*) <= 1 THEN (SELECT q FROM quotas LIMIT 1)
      ELSE jsonb_agg(q)
    END
      INTO v_rateio_quota
      FROM quotas;
  END IF;

  RETURN jsonb_build_object(
    'competencia', p_competencia,
    'bruto', v_bruto,
    'esperado', v_esperado,
    'glosas', v_glosas,
    'liquido_estimado', v_esperado - v_glosas,
    'itens', COALESCE(v_itens, '[]'::jsonb),
    'glosa_breakdown', COALESCE(v_glosa_breakdown, '[]'::jsonb),
    'payments', COALESCE(v_payments, '[]'::jsonb),
    'empresa_tem_pool', COALESCE(v_empresa_tem_pool, false),
    'empresa_liquido_total', v_empresa_liquido_total,
    'rateio_itens', CASE WHEN COALESCE(v_empresa_tem_pool, false) THEN COALESCE(v_rateio_itens, '[]'::jsonb) ELSE NULL END,
    'rateio_quota', v_rateio_quota
  );
END;
$function$;
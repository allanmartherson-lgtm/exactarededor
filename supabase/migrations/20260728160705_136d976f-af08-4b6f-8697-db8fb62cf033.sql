
CREATE OR REPLACE FUNCTION public.get_lote_intervention_preview(p_payment_id uuid)
 RETURNS TABLE(id uuid, payment_id uuid, item_id uuid, company_id uuid, company_name text, doctor_name text, procedure_code text, procedure_name text, valor_regra numeric, valor_pago_final numeric, delta numeric, fonte text, cancellation_reason text, autor_id uuid, approved_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_hospital_id uuid;
  v_glosa jsonb := '{}'::jsonb;
  v_accept_expected_cutoff constant timestamptz := '2026-07-01 00:00:00+00';
BEGIN
  SELECT p.hospital_id INTO v_hospital_id FROM public.payments p WHERE p.id = p_payment_id;
  IF v_hospital_id IS NULL THEN RETURN; END IF;
  PERFORM public.assert_hospital_access(v_hospital_id);

  SELECT COALESCE(jsonb_object_agg(g.company_id::text, true), '{}'::jsonb)
    INTO v_glosa
    FROM (
      SELECT DISTINCT gpa.company_id
      FROM public.glosa_payment_applications gpa
      WHERE gpa.payment_id = p_payment_id AND gpa.reverted_at IS NULL
    ) g;

  RETURN QUERY
  WITH base AS (
    SELECT
      pi.id AS item_id,
      pi.payment_id,
      pi.company_id,
      pi.company_name,
      pi.doctor_name,
      pi.procedure_code,
      pi.procedure_name,
      pi.expected_amount,
      pi.gross_amount,
      pi.gross_amount_original,
      pi.is_cancelled,
      pi.cancellation_reason,
      pi.acatado_at,
      pi.acatado_by,
      pi.gross_override_at,
      pi.gross_override_by,
      pi.cancelled_by,
      pi.updated_at,
      CASE
        WHEN pi.is_cancelled THEN 'cancelamento'
        WHEN pi.company_id IS NOT NULL
          AND (v_glosa ? pi.company_id::text) THEN 'glosa'
        WHEN pi.gross_override_at IS NOT NULL
          AND pi.acatado_at IS NOT NULL
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'aceite_esperado'
        WHEN pi.gross_override_at IS NOT NULL THEN 'ajuste_manual'
        WHEN pi.acatado_at IS NOT NULL
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'aceite_esperado'
        WHEN pi.acatado_at IS NOT NULL THEN 'aceite_pago'
        WHEN ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'sem_intervencao'
        ELSE 'ajuste_manual'
      END AS fonte
    FROM public.payment_items pi
    WHERE pi.payment_id = p_payment_id
  )
  SELECT
    b.item_id AS id,
    b.payment_id,
    b.item_id,
    b.company_id,
    b.company_name,
    b.doctor_name,
    b.procedure_code,
    b.procedure_name,
    COALESCE(b.expected_amount, 0)::numeric AS valor_regra,
    COALESCE(b.gross_amount, 0)::numeric    AS valor_pago_final,
    CASE
      WHEN b.fonte = 'aceite_esperado' THEN 0::numeric
      WHEN b.acatado_at IS NOT NULL
        AND b.acatado_at >= v_accept_expected_cutoff
        AND ABS(COALESCE(b.expected_amount, 0) - COALESCE(b.gross_amount, 0)) < 0.01
        AND b.gross_amount_original IS NOT NULL
        AND ABS(b.gross_amount_original - COALESCE(b.gross_amount, 0)) >= 0.01
        THEN (b.gross_amount_original - COALESCE(b.gross_amount, 0))::numeric
      ELSE (COALESCE(b.expected_amount, 0) - COALESCE(b.gross_amount, 0))::numeric
    END AS delta,
    b.fonte,
    CASE WHEN b.is_cancelled THEN b.cancellation_reason::text ELSE NULL END AS cancellation_reason,
    COALESCE(b.cancelled_by, b.gross_override_by, b.acatado_by) AS autor_id,
    COALESCE(b.acatado_at, b.gross_override_at, b.updated_at, now()) AS approved_at
  FROM base b

  UNION ALL

  -- Glosas/débitos aplicados no lote (não revertidos)
  SELECT
    gpa.id AS id,
    gpa.payment_id,
    NULL::uuid AS item_id,
    gpa.company_id,
    c.name AS company_name,
    d.name AS doctor_name,
    NULL::text AS procedure_code,
    CASE
      WHEN gd.description IS NOT NULL AND length(trim(gd.description)) > 0
        THEN 'Glosa: ' || gd.description
      ELSE 'Glosa/débito aplicado'
    END AS procedure_name,
    0::numeric AS valor_regra,
    (-COALESCE(gpa.valor_aplicado, 0))::numeric AS valor_pago_final,
    COALESCE(gpa.valor_aplicado, 0)::numeric AS delta,
    'glosa_lancada'::text AS fonte,
    NULL::text AS cancellation_reason,
    COALESCE(gpa.confirmed_by, gpa.applied_by) AS autor_id,
    COALESCE(gpa.confirmed_at, gpa.applied_at) AS approved_at
  FROM public.glosa_payment_applications gpa
  LEFT JOIN public.companies c ON c.id = gpa.company_id
  LEFT JOIN public.doctors d ON d.id = gpa.doctor_id
  LEFT JOIN public.glosa_debts gd ON gd.id = gpa.glosa_debt_id
  WHERE gpa.payment_id = p_payment_id
    AND gpa.reverted_at IS NULL;
END;
$function$;


CREATE OR REPLACE FUNCTION public.get_intervention_preview(p_hospital_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_h uuid := COALESCE(p_hospital_id, public.current_active_hospital());
  v_pending_states text[] := ARRAY[
    'em_analise_ia','revisao_analista','concluida_analista',
    'aguardando_validacao','devolvido_analista','aguardando_aprovacao',
    'em_questionamento'
  ];
  v_accept_expected_cutoff constant timestamptz := '2026-07-04 00:00:00+00';
BEGIN
  WITH candidate_payments AS (
    SELECT p.id, p.description, p.reference, p.competence_month, p.status::text AS status, p.hospital_id
    FROM public.payments p
    WHERE p.status::text = ANY(v_pending_states)
      AND COALESCE(p.import_mode, 'normal') <> 'historico'
      AND p.hospital_id = v_h
  ),
  glosa_by_payment AS (
    SELECT payment_id, jsonb_object_agg(company_id::text, true) AS by_company
    FROM (
      SELECT DISTINCT payment_id, company_id
      FROM public.glosa_payment_applications
      WHERE reverted_at IS NULL
        AND payment_id IN (SELECT id FROM candidate_payments)
    ) g
    GROUP BY payment_id
  ),
  item_rows AS (
    SELECT
      cp.id AS payment_id, cp.description, cp.reference, cp.competence_month, cp.status,
      pi.id AS item_id, pi.is_cancelled, pi.acatado_at, pi.gross_override_at,
      pi.gross_override_reason,
      COALESCE(pi.package_absorbed, false) AS package_absorbed,
      COALESCE(pi.expected_amount, 0) AS expected_amount,
      COALESCE(pi.gross_amount, 0) AS gross_amount,
      pi.gross_amount_original,
      pi.expected_amount_original,
      CASE
        WHEN pi.gross_override_reason = 'acatado_pago'
             AND pi.expected_amount_original IS NOT NULL
          THEN COALESCE(pi.gross_amount, 0) - pi.expected_amount_original
        WHEN pi.acatado_at IS NOT NULL
          AND pi.acatado_at >= v_accept_expected_cutoff
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          AND pi.gross_amount_original IS NOT NULL
          AND ABS(pi.gross_amount_original - COALESCE(pi.gross_amount, 0)) >= 0.01
          THEN pi.gross_amount_original - COALESCE(pi.gross_amount, 0)
        ELSE COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)
      END AS delta,
      CASE
        WHEN pi.is_cancelled THEN 'cancelamento'
        WHEN pi.company_id IS NOT NULL
          AND (COALESCE((SELECT by_company FROM glosa_by_payment gb WHERE gb.payment_id = cp.id), '{}'::jsonb) ? pi.company_id::text)
          THEN 'glosa'
        WHEN pi.gross_override_reason = 'acatado_pago' THEN 'aceite_pago'
        WHEN pi.gross_override_at IS NOT NULL
          AND pi.acatado_at IS NOT NULL
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'aceite_esperado'
        WHEN pi.gross_override_at IS NOT NULL THEN 'ajuste_manual'
        WHEN pi.acatado_at IS NOT NULL
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'aceite_esperado'
        WHEN pi.acatado_at IS NOT NULL THEN 'aceite_pago'
        WHEN ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          THEN 'sem_intervencao'
        ELSE 'ajuste_manual'
      END AS fonte
    FROM candidate_payments cp
    JOIN public.payment_items pi ON pi.payment_id = cp.id
  ),
  impacting AS (
    SELECT * FROM item_rows
    WHERE fonte <> 'sem_intervencao'
      AND (is_cancelled OR acatado_at IS NOT NULL OR gross_override_at IS NOT NULL)
      AND NOT package_absorbed
      AND ABS(delta) > 0.005
  ),
  by_payment_items AS (
    SELECT payment_id, description, reference, competence_month, status,
      COUNT(*) AS qtd_itens,
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(delta), 0) AS saldo
    FROM impacting
    GROUP BY payment_id, description, reference, competence_month, status
  ),
  glosa_apps AS (
    SELECT cp.id AS payment_id, cp.description, cp.reference, cp.competence_month, cp.status,
      COUNT(*) AS qtd_itens,
      COALESCE(SUM(CASE WHEN gpa.valor_aplicado > 0 THEN gpa.valor_aplicado ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN gpa.valor_aplicado < 0 THEN -gpa.valor_aplicado ELSE 0 END), 0) AS perda,
      COALESCE(SUM(gpa.valor_aplicado), 0) AS saldo
    FROM candidate_payments cp
    JOIN public.glosa_payment_applications gpa ON gpa.payment_id = cp.id
    WHERE gpa.reverted_at IS NULL
    GROUP BY cp.id, cp.description, cp.reference, cp.competence_month, cp.status
  ),
  by_payment AS (
    SELECT
      COALESCE(i.payment_id, g.payment_id) AS payment_id,
      COALESCE(i.description, g.description) AS description,
      COALESCE(i.reference, g.reference) AS reference,
      COALESCE(i.competence_month, g.competence_month) AS competence_month,
      COALESCE(i.status, g.status) AS status,
      COALESCE(i.qtd_itens, 0) + COALESCE(g.qtd_itens, 0) AS qtd_itens,
      COALESCE(i.economia, 0) + COALESCE(g.economia, 0) AS economia,
      COALESCE(i.perda, 0) + COALESCE(g.perda, 0) AS perda,
      COALESCE(i.saldo, 0) + COALESCE(g.saldo, 0) AS saldo
    FROM by_payment_items i
    FULL OUTER JOIN glosa_apps g ON g.payment_id = i.payment_id
  ),
  totals AS (
    SELECT
      COUNT(*)::int AS qtd_lotes,
      COALESCE(SUM(qtd_itens),0)::int AS qtd_itens,
      COALESCE(SUM(economia),0) AS economia,
      COALESCE(SUM(perda),0) AS perda,
      COALESCE(SUM(saldo),0) AS saldo
    FROM by_payment
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(t) FROM totals t),
    'by_payment', COALESCE((SELECT jsonb_agg(to_jsonb(bp) ORDER BY ABS(bp.saldo) DESC) FROM by_payment bp), '[]'::jsonb),
    'window', jsonb_build_object('hospital_id', v_h)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

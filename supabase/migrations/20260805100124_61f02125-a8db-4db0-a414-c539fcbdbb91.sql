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
    d.full_name AS doctor_name,
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

REVOKE EXECUTE ON FUNCTION public.get_lote_intervention_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lote_intervention_preview(uuid) TO authenticated;
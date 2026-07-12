
CREATE OR REPLACE FUNCTION public.get_lote_intervention_preview(p_payment_id uuid)
RETURNS TABLE (
  id uuid,
  payment_id uuid,
  item_id uuid,
  company_id uuid,
  company_name text,
  doctor_name text,
  procedure_code text,
  procedure_name text,
  valor_regra numeric,
  valor_pago_final numeric,
  delta numeric,
  fonte text,
  cancellation_reason text,
  autor_id uuid,
  approved_at timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_hospital_id uuid;
  v_glosa jsonb := '{}'::jsonb;
  v_accept_expected_cutoff constant timestamptz := '2026-07-01 00:00:00+00';
BEGIN
  SELECT hospital_id INTO v_hospital_id FROM public.payments WHERE id = p_payment_id;
  IF v_hospital_id IS NULL THEN RETURN; END IF;
  PERFORM public.assert_hospital_access(v_hospital_id);

  SELECT COALESCE(jsonb_object_agg(g.company_id::text, true), '{}'::jsonb)
    INTO v_glosa
    FROM (
      SELECT DISTINCT company_id
      FROM public.glosa_payment_applications
      WHERE payment_id = p_payment_id AND reverted_at IS NULL
    ) g;

  RETURN QUERY
  SELECT
    pi.id AS id,
    pi.payment_id,
    pi.id AS item_id,
    pi.company_id,
    pi.company_name,
    pi.doctor_name,
    pi.procedure_code,
    pi.procedure_name,
    COALESCE(pi.expected_amount, 0)::numeric AS valor_regra,
    COALESCE(pi.gross_amount, 0)::numeric    AS valor_pago_final,
    CASE
      WHEN pi.acatado_at IS NOT NULL
        AND pi.acatado_at >= v_accept_expected_cutoff
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        AND pi.gross_amount_original IS NOT NULL
        AND ABS(pi.gross_amount_original - COALESCE(pi.gross_amount, 0)) >= 0.01
        THEN (pi.gross_amount_original - COALESCE(pi.gross_amount, 0))::numeric
      ELSE (COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0))::numeric
    END AS delta,
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
    END AS fonte,
    CASE WHEN pi.is_cancelled THEN pi.cancellation_reason::text ELSE NULL END AS cancellation_reason,
    COALESCE(pi.cancelled_by, pi.gross_override_by, pi.acatado_by) AS autor_id,
    COALESCE(pi.acatado_at, pi.gross_override_at, pi.updated_at, now()) AS approved_at
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_lote_intervention_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_lote_intervention_preview(uuid) TO authenticated;

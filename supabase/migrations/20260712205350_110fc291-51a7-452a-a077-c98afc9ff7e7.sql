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
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_payment RECORD;
  v_glosa_by_company jsonb := '{}'::jsonb;
  v_accept_expected_cutoff timestamptz := '2026-07-01 00:00:00+00';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('diretor'::app_role,'admin'::app_role,'validador'::app_role,'analista'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT p.id AS pid, p.hospital_id, p.approved_at, p.approved_by
    INTO v_payment
    FROM public.payments p
    WHERE p.id = p_payment_id;
  IF v_payment.pid IS NULL THEN RETURN; END IF;

  SELECT COALESCE(jsonb_object_agg(g.company_id::text, true), '{}'::jsonb)
    INTO v_glosa_by_company
    FROM (
      SELECT DISTINCT gpa.company_id
      FROM public.glosa_payment_applications gpa
      WHERE gpa.payment_id = p_payment_id AND gpa.reverted_at IS NULL
    ) g;

  RETURN QUERY
  SELECT
    pi.id,
    pi.payment_id,
    pi.id AS item_id,
    pi.company_id,
    pi.company_name,
    pi.doctor_name,
    pi.procedure_code,
    pi.procedure_name,
    COALESCE(pi.expected_amount, 0)::numeric,
    COALESCE(pi.gross_amount, 0)::numeric,
    (CASE
      WHEN pi.acatado_at IS NOT NULL
        AND pi.acatado_at >= v_accept_expected_cutoff
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        AND pi.gross_amount_original IS NOT NULL
        AND ABS(pi.gross_amount_original - COALESCE(pi.gross_amount, 0)) >= 0.01
        THEN pi.gross_amount_original - COALESCE(pi.gross_amount, 0)
      ELSE COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)
    END)::numeric,
    (CASE
      WHEN pi.is_cancelled THEN 'cancelamento'
      WHEN pi.company_id IS NOT NULL
        AND (v_glosa_by_company ? pi.company_id::text) THEN 'glosa'
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
    END)::text,
    (CASE WHEN pi.is_cancelled THEN pi.cancellation_reason::text ELSE NULL END)::text,
    COALESCE(pi.cancelled_by, pi.gross_override_by, pi.acatado_by),
    COALESCE(pi.acatado_at, pi.gross_override_at, pi.cancelled_at, pi.updated_at, now())
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;
END $$;

GRANT EXECUTE ON FUNCTION public.get_lote_intervention_preview(uuid) TO authenticated;
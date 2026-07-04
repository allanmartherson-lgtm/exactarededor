CREATE OR REPLACE FUNCTION public.get_intervention_preview(
  p_hospital_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_pending_states text[] := ARRAY[
    'em_analise_ia','revisao_analista','concluida_analista',
    'aguardando_validacao','devolvido_analista','aguardando_aprovacao',
    'em_questionamento','revisao_pos_aprovacao'
  ];
  v_accept_expected_cutoff constant timestamptz := '2026-07-04 00:00:00+00';
BEGIN
  WITH candidate_payments AS (
    SELECT p.id, p.description, p.competence_month, p.status::text AS status, p.hospital_id
    FROM public.payments p
    WHERE p.status::text = ANY(v_pending_states)
      AND COALESCE(p.import_mode, 'normal') <> 'historico'
      AND (p_hospital_id IS NULL OR p.hospital_id = p_hospital_id)
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
      cp.id AS payment_id,
      cp.description,
      cp.competence_month,
      cp.status,
      pi.id AS item_id,
      pi.is_cancelled,
      pi.acatado_at,
      pi.gross_override_at,
      COALESCE(pi.expected_amount, 0) AS expected_amount,
      COALESCE(pi.gross_amount, 0) AS gross_amount,
      pi.gross_amount_original,
      CASE
        WHEN pi.acatado_at IS NOT NULL
          AND pi.acatado_at >= v_accept_expected_cutoff
          AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
          AND pi.gross_amount_original IS NOT NULL
          AND pi.gross_amount_original > COALESCE(pi.gross_amount, 0)
          THEN pi.gross_amount_original - COALESCE(pi.gross_amount, 0)
        ELSE COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)
      END AS delta,
      CASE
        WHEN pi.is_cancelled THEN 'cancelamento'
        WHEN pi.company_id IS NOT NULL
          AND (COALESCE((SELECT by_company FROM glosa_by_payment gb WHERE gb.payment_id = cp.id), '{}'::jsonb) ? pi.company_id::text)
          THEN 'glosa'
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
    -- só itens que efetivamente movem o saldo (intervenção humana)
    SELECT * FROM item_rows
    WHERE fonte <> 'sem_intervencao'
      AND (
        is_cancelled
        OR acatado_at IS NOT NULL
        OR gross_override_at IS NOT NULL
      )
      AND ABS(delta) > 0.005
  ),
  by_payment AS (
    SELECT
      payment_id,
      MAX(description) AS description,
      MAX(competence_month::text) AS competence_month,
      MAX(status) AS status,
      COUNT(*)::int AS qtd_itens,
      SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS economia,
      SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS perda,
      SUM(delta) AS saldo
    FROM impacting
    GROUP BY payment_id
  ),
  summary AS (
    SELECT
      COALESCE(SUM(economia), 0) AS economia,
      COALESCE(SUM(perda), 0) AS perda,
      COALESCE(SUM(saldo), 0) AS saldo,
      COALESCE(SUM(qtd_itens), 0)::int AS qtd_itens,
      COUNT(*)::int AS qtd_lotes
    FROM by_payment
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_payment', COALESCE(
      (SELECT jsonb_agg(to_jsonb(bp) ORDER BY bp.saldo DESC) FROM by_payment bp),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END $$;

GRANT EXECUTE ON FUNCTION public.get_intervention_preview(uuid) TO authenticated;
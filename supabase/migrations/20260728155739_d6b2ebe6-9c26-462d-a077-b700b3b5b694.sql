
-- 1) Coluna nova
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS expected_amount_original numeric;

-- 2) RPC accept_payment_item_keep_paid — preservar esperado original
CREATE OR REPLACE FUNCTION public.accept_payment_item_keep_paid(
  _item_id uuid,
  _justification text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_status text;
  v_gross numeric;
  v_expected numeric;
  v_gross_original numeric;
  v_expected_original numeric;
  v_override_reason text;
  v_effective_paid numeric;
BEGIN
  SELECT payment_id INTO v_payment_id FROM public.payment_items WHERE id = _item_id;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_payment_id::text, 0));

  SELECT ai_status::text, gross_amount, expected_amount, gross_amount_original,
         expected_amount_original, gross_override_reason
    INTO v_status, v_gross, v_expected, v_gross_original,
         v_expected_original, v_override_reason
  FROM public.payment_items
  WHERE id = _item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF _justification IS NULL OR length(btrim(_justification)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Justificativa muito curta (mín. 20 caracteres).');
  END IF;

  IF v_status NOT IN ('reprovado', 'alerta')
     AND NOT (v_status = 'acatado' AND v_override_reason = 'acatado_esperado' AND v_gross_original IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Não é possível manter pago para item com status "%s".', v_status));
  END IF;

  v_effective_paid := CASE
    WHEN v_status = 'acatado' AND v_override_reason = 'acatado_esperado' AND v_gross_original IS NOT NULL THEN v_gross_original
    ELSE v_gross
  END;

  UPDATE public.payment_items SET
    acatado_status_original = CASE
      WHEN ai_status::text = 'acatado' THEN acatado_status_original
      ELSE ai_status::text
    END,
    ai_status = 'acatado'::item_ai_status,
    acatado_by = auth.uid(),
    acatado_at = NOW(),
    gross_amount = v_effective_paid,
    -- Preserva o esperado original na 1a vez que vira "manter pago";
    -- só é limpo pela reversão (undo_accept_payment_item).
    expected_amount_original = CASE
      WHEN expected_amount_original IS NOT NULL THEN expected_amount_original
      WHEN v_expected IS NOT NULL AND ABS(COALESCE(v_expected,0) - v_effective_paid) >= 0.01 THEN v_expected
      ELSE expected_amount_original
    END,
    expected_amount = v_effective_paid,
    ai_findings = CASE
      WHEN ai_findings IS NULL THEN jsonb_build_object('expected_amount', v_effective_paid, 'alerts', '[]'::jsonb)
      ELSE jsonb_set(
             jsonb_set(ai_findings, '{expected_amount}', to_jsonb(v_effective_paid), true),
             '{alerts}', '[]'::jsonb, true)
    END,
    gross_amount_original = CASE
      WHEN v_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_amount_original
    END,
    gross_override_at = NOW(),
    gross_override_by = auth.uid(),
    gross_override_reason = 'acatado_pago'
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', CASE WHEN v_status = 'acatado' THEN 'acate_convertido_para_pago' ELSE 'acatado_mantendo_pago' END,
      'status_anterior', v_status,
      'gross_anterior', v_gross,
      'gross_mantido', v_effective_paid,
      'esperado_anterior', v_expected,
      'esperado_alinhado', v_effective_paid,
      'justificativa', _justification
    ));

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 3) Prévia — usar esperado original em acatado_pago; ignorar itens absorvidos por pacote.
CREATE OR REPLACE FUNCTION public.get_intervention_preview(
  p_hospital_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        -- Aceite "manter pago": delta real = gross - esperado ORIGINAL (antes do alinhamento)
        WHEN pi.gross_override_reason = 'acatado_pago'
             AND pi.expected_amount_original IS NOT NULL
          THEN COALESCE(pi.gross_amount, 0) - pi.expected_amount_original
        -- Aceite "valor esperado" pós-cutoff: delta = original - novo gross
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
      -- Desambiguação de pacote não é ganho nem perda financeira.
      AND NOT package_absorbed
      AND ABS(delta) > 0.005
  ),
  by_payment AS (
    SELECT payment_id, description, reference, competence_month, status,
      COUNT(*) AS qtd_itens,
      COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS economia,
      COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0) AS perda,
      COALESCE(SUM(delta), 0) AS saldo
    FROM impacting
    GROUP BY payment_id, description, reference, competence_month, status
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
$$;

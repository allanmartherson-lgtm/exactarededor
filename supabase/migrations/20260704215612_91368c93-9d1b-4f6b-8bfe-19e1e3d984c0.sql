-- Recalcula a materialização do ledger de intervenções para incluir a economia
-- gerada quando o analista clica "Aceitar esperado" no item (o motor evitou
-- que ele pagasse o valor cheio informado na planilha).
--
-- Cutoff: só conta para aceites com acatado_at >= cutoff. Pagamentos já
-- aprovados ou em ciclo antes disso permanecem com delta=0 na fonte
-- aceite_esperado (comportamento anterior), conforme decisão de produto.
CREATE OR REPLACE FUNCTION public.materialize_intervention_ledger(p_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment record;
  v_glosa_by_company jsonb;
  -- Marco a partir do qual passamos a computar economia por aceite do esperado.
  -- Aceites anteriores continuam neutros no ledger (não retroagem).
  v_accept_expected_cutoff constant timestamptz := '2026-07-04 00:00:00+00';
BEGIN
  SELECT id, status, approved_at, approved_by, hospital_id
    INTO v_payment FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN RETURN; END IF;

  DELETE FROM public.intervention_ledger WHERE payment_id = p_payment_id;

  SELECT COALESCE(jsonb_object_agg(company_id::text, true), '{}'::jsonb)
    INTO v_glosa_by_company
    FROM (
      SELECT DISTINCT company_id
      FROM public.glosa_payment_applications
      WHERE payment_id = p_payment_id AND reverted_at IS NULL
    ) g;

  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name,
    valor_regra, valor_pago_final, delta,
    fonte, cancellation_reason, autor_id,
    approved_at, approved_by
  )
  SELECT
    pi.payment_id,
    pi.id,
    v_payment.hospital_id,
    pi.company_id,
    pi.company_name,
    pi.doctor_name,
    pi.procedure_code,
    pi.procedure_name,
    COALESCE(pi.expected_amount, 0)                        AS valor_regra,
    COALESCE(pi.gross_amount, 0)                           AS valor_pago_final,
    CASE
      -- Novo: aceite do esperado feito daqui pra frente. Economia = quanto o
      -- analista teria pago (gross_amount_original) menos o que efetivamente
      -- foi pago após o aceite (gross_amount = expected).
      WHEN pi.acatado_at IS NOT NULL
        AND pi.acatado_at >= v_accept_expected_cutoff
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        AND pi.gross_amount_original IS NOT NULL
        AND pi.gross_amount_original > COALESCE(pi.gross_amount, 0)
        THEN pi.gross_amount_original - COALESCE(pi.gross_amount, 0)
      -- Demais casos preservam a fórmula original (regra − pago).
      ELSE COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)
    END                                                    AS delta,
    CASE
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
    END AS fonte,
    CASE WHEN pi.is_cancelled THEN pi.cancellation_reason::text ELSE NULL END,
    COALESCE(pi.cancelled_by, pi.gross_override_by, pi.acatado_by, v_payment.approved_by) AS autor_id,
    COALESCE(v_payment.approved_at, now()),
    v_payment.approved_by
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;
END $$;

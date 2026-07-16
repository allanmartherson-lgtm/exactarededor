CREATE OR REPLACE FUNCTION public.materialize_intervention_ledger(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payment RECORD;
BEGIN
  SELECT id, hospital_id, approved_at, approved_by
    INTO v_payment
    FROM public.payments
    WHERE id = p_payment_id;
  IF v_payment.id IS NULL THEN RETURN; END IF;

  DELETE FROM public.intervention_ledger WHERE payment_id = p_payment_id;

  -- Item-a-item. Baseline = PAGO PRÉ-INTERVENÇÃO:
  --   1) gross_amount_original quando gravado com valor real,
  --   2) gross_amount_at_time da 1ª versão da análise (snapshot),
  --   3) gross_amount atual (fallback).
  -- Itens criados via conciliação (crédito/débito) têm baseline = 0 (não existiam
  -- antes da intervenção), então delta = 0 − gross_amount = −gross_amount.
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
    COALESCE(pi.expected_amount, 0) AS valor_regra,
    COALESCE(pi.gross_amount, 0)    AS valor_pago_final,
    CASE
      WHEN pi.item_origem IN ('conciliacao_credito','conciliacao_debito') THEN
        -- baseline = 0 (item não existia antes da intervenção).
        -- Delta neutro: incorporação via conciliação NÃO é economia nem perda
        -- do trabalho da Exacta — é correção do lote. A fonte fica registrada
        -- ('conciliacao_credito'/'conciliacao_debito') para rastreabilidade,
        -- mas não impacta KPIs de savings/perda.
        0
      WHEN pi.is_cancelled THEN
        COALESCE(
          NULLIF(pi.gross_amount_original, 0),
          (SELECT v.gross_amount_at_time FROM public.ai_analysis_versions v
             WHERE v.item_id = pi.id AND v.gross_amount_at_time IS NOT NULL
             ORDER BY v.version ASC LIMIT 1),
          pi.gross_amount, 0
        )
      WHEN pi.gross_override_at IS NOT NULL OR pi.acatado_at IS NOT NULL THEN
        COALESCE(
          NULLIF(pi.gross_amount_original, 0),
          (SELECT v.gross_amount_at_time FROM public.ai_analysis_versions v
             WHERE v.item_id = pi.id AND v.gross_amount_at_time IS NOT NULL
             ORDER BY v.version ASC LIMIT 1),
          pi.gross_amount, 0
        ) - COALESCE(pi.gross_amount, 0)
      ELSE 0
    END AS delta,
    CASE
      WHEN pi.item_origem = 'conciliacao_credito' THEN 'conciliacao_credito'
      WHEN pi.item_origem = 'conciliacao_debito'  THEN 'conciliacao_debito'
      WHEN pi.is_cancelled THEN 'cancelamento'
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
    COALESCE(pi.gross_override_by, pi.cancelled_by, pi.acatado_by, v_payment.approved_by) AS autor_id,
    COALESCE(v_payment.approved_at, now()),
    v_payment.approved_by
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;

  -- Linhas 'glosa_pj' agregadas (mantém regra existente)
  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name,
    valor_regra, valor_pago_final, delta,
    fonte, cancellation_reason, autor_id,
    approved_at, approved_by
  )
  SELECT
    p_payment_id,
    NULL,
    v_payment.hospital_id,
    gd.company_id,
    c.name,
    NULL, NULL, NULL,
    0,
    -SUM(COALESCE(gp.amount_applied,0)),
    SUM(COALESCE(gp.amount_applied,0)),
    'glosa_pj',
    NULL,
    v_payment.approved_by,
    COALESCE(v_payment.approved_at, now()),
    v_payment.approved_by
  FROM public.glosa_debt_payments gp
  JOIN public.glosa_debts gd ON gd.id = gp.glosa_debt_id
  JOIN public.companies c ON c.id = gd.company_id
  WHERE gp.payment_id = p_payment_id
    AND COALESCE(gp.reverted, false) = false
  GROUP BY gd.company_id, c.name
  HAVING SUM(COALESCE(gp.amount_applied,0)) > 0;
END;
$function$;
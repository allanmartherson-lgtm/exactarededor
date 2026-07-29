
ALTER TABLE public.intervention_ledger
  ADD COLUMN IF NOT EXISTS attendance_number text;

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

  IF v_payment.approved_at IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name, attendance_number,
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
    pi.attendance_number,
    COALESCE(pi.expected_amount, 0) AS valor_regra,
    COALESCE(pi.gross_amount, 0)    AS valor_pago_final,
    CASE
      WHEN pi.item_origem IN ('conciliacao_credito','conciliacao_debito') THEN 0
      WHEN pi.is_cancelled THEN
        COALESCE(
          (SELECT v.gross_amount_at_time FROM public.ai_analysis_versions v
             WHERE v.item_id = pi.id AND v.gross_amount_at_time IS NOT NULL
             ORDER BY v.version ASC LIMIT 1),
          NULLIF(pi.gross_amount_original, 0),
          pi.gross_amount, 0
        )
      WHEN (pi.gross_override_at IS NOT NULL OR pi.acatado_at IS NOT NULL)
        AND ABS(COALESCE(pi.expected_amount, 0) - COALESCE(pi.gross_amount, 0)) < 0.01
        THEN 0
      WHEN pi.gross_override_at IS NOT NULL OR pi.acatado_at IS NOT NULL THEN
        COALESCE(
          (SELECT v.gross_amount_at_time FROM public.ai_analysis_versions v
             WHERE v.item_id = pi.id AND v.gross_amount_at_time IS NOT NULL
             ORDER BY v.version ASC LIMIT 1),
          NULLIF(pi.gross_amount_original, 0),
          pi.gross_amount, 0
        ) - COALESCE(pi.gross_amount, 0)
      ELSE 0
    END AS delta,
    CASE
      WHEN pi.item_origem = 'conciliacao_credito' THEN 'conciliacao_credito'
      WHEN pi.item_origem = 'conciliacao_debito'  THEN 'conciliacao_debito'
      WHEN pi.is_cancelled THEN 'cancelamento'
      WHEN pi.gross_override_at IS NOT NULL
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
    COALESCE(pi.gross_override_by, pi.cancelled_by, pi.acatado_by) AS autor_id,
    v_payment.approved_at,
    v_payment.approved_by
  FROM public.payment_items pi
  WHERE pi.payment_id = p_payment_id;

  -- Glosa por PJ: uma linha por item de glosa (glosa_debt_items -> glosa_items),
  -- não mais somada por empresa. Deduplica parcelas usando DISTINCT no
  -- glosa_debt_item.id (applied_amount é acumulado no item, então uma linha
  -- só por debt_item cobre todas as parcelas sem dobrar valor).
  INSERT INTO public.intervention_ledger (
    payment_id, item_id, hospital_id, company_id, company_name,
    doctor_name, procedure_code, procedure_name, attendance_number,
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
    gi.doctor_name,
    gi.procedure_code,
    gi.procedure_name,
    gi.attendance_number,
    0,
    -COALESCE(gdi.applied_amount, 0),
    COALESCE(gdi.applied_amount, 0),
    'glosa_pj',
    NULL,
    COALESCE(
      (array_agg(gp.applied_by   ORDER BY gp.applied_at ASC)
         FILTER (WHERE gp.applied_by   IS NOT NULL))[1],
      (array_agg(gp.confirmed_by ORDER BY gp.applied_at ASC)
         FILTER (WHERE gp.confirmed_by IS NOT NULL))[1]
    ) AS autor_id,
    v_payment.approved_at,
    v_payment.approved_by
  FROM public.glosa_payment_applications gp
  JOIN public.glosa_debts gd       ON gd.id = gp.glosa_debt_id
  JOIN public.companies    c       ON c.id  = gd.company_id
  JOIN public.glosa_debt_items gdi ON gdi.debt_id = gd.id
  JOIN public.glosa_items      gi  ON gi.id = gdi.glosa_item_id
  WHERE gp.payment_id = p_payment_id
    AND gp.reverted_at IS NULL
  GROUP BY gd.company_id, c.name, gdi.id, gdi.applied_amount,
           gi.doctor_name, gi.procedure_code, gi.procedure_name, gi.attendance_number
  HAVING COALESCE(gdi.applied_amount, 0) > 0;
END;
$function$;

-- Backfill único: reconstrói o ledger de todos os pagamentos aprovados.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.payments WHERE approved_at IS NOT NULL LOOP
    PERFORM public.materialize_intervention_ledger(r.id);
  END LOOP;
END $$;

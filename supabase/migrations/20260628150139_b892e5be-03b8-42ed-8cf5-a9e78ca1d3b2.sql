CREATE OR REPLACE FUNCTION public.accept_payment_item_keep_paid(_item_id uuid, _justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_gross numeric;
  v_expected numeric;
  v_gross_original numeric;
  v_override_reason text;
  v_effective_paid numeric;
BEGIN
  SELECT ai_status::text, gross_amount, expected_amount, gross_amount_original, gross_override_reason
    INTO v_status, v_gross, v_expected, v_gross_original, v_override_reason
  FROM payment_items WHERE id = _item_id;

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

  UPDATE payment_items SET
    acatado_status_original = CASE
      WHEN ai_status::text = 'acatado' THEN acatado_status_original
      ELSE ai_status::text
    END,
    ai_status = 'acatado'::item_ai_status,
    acatado_by = auth.uid(),
    acatado_at = NOW(),
    gross_amount = v_effective_paid,
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
      'esperado_referencia', v_expected,
      'override_anterior', v_override_reason,
      'justificativa', _justification
    ));

  RETURN jsonb_build_object('ok', true, 'gross_mantido', v_effective_paid);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.accept_payment_item_keep_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_payment_item_keep_paid(uuid, text) TO authenticated;

UPDATE public.payment_items
   SET gross_override_reason = 'acatado_pago',
       gross_override_at = COALESCE(acatado_at, now()),
       gross_override_by = acatado_by
 WHERE ai_status::text = 'acatado'
   AND gross_override_reason IS NULL
   AND gross_amount IS DISTINCT FROM expected_amount;
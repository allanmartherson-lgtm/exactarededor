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
BEGIN
  SELECT ai_status::text, gross_amount, expected_amount
    INTO v_status, v_gross, v_expected
  FROM payment_items WHERE id = _item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF v_status NOT IN ('reprovado', 'alerta') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Não é possível acatar item com status "%s". Apenas reprovado ou alerta.', v_status));
  END IF;

  IF _justification IS NULL OR length(btrim(_justification)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Justificativa muito curta (mín. 20 caracteres).');
  END IF;

  UPDATE payment_items SET
    acatado_status_original = ai_status::text,
    ai_status = 'acatado'::item_ai_status,
    acatado_by = auth.uid(),
    acatado_at = NOW()
    -- NÃO altera gross_amount: o valor pago é a verdade.
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', 'acatado_mantendo_pago',
      'status_anterior', v_status,
      'gross_mantido', v_gross,
      'esperado_referencia', v_expected,
      'justificativa', _justification
    ));

  RETURN jsonb_build_object('ok', true, 'gross_mantido', v_gross);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.accept_payment_item_keep_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_payment_item_keep_paid(uuid, text) TO authenticated;
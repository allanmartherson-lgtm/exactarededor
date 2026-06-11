
CREATE OR REPLACE FUNCTION public.accept_payment_item(_item_id uuid, _justification text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_gross numeric;
  v_expected numeric;
  v_already_overridden boolean;
BEGIN
  SELECT ai_status::text, gross_amount, expected_amount, (gross_override_at IS NOT NULL)
    INTO v_status, v_gross, v_expected, v_already_overridden
  FROM payment_items WHERE id = _item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF v_status NOT IN ('reprovado', 'alerta') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Não é possível acatar item com status "%s". Apenas reprovado ou alerta.', v_status));
  END IF;

  UPDATE payment_items SET
    acatado_status_original = ai_status::text,
    ai_status = 'acatado'::item_ai_status,
    acatado_by = auth.uid(),
    acatado_at = NOW(),
    -- Sobrescreve o "valor a pagar" com o esperado quando há esperado válido.
    -- Preserva o original apenas na primeira sobrescrita.
    gross_amount = CASE
      WHEN v_expected IS NOT NULL THEN v_expected
      ELSE gross_amount
    END,
    gross_amount_original = CASE
      WHEN v_expected IS NOT NULL AND NOT v_already_overridden THEN v_gross
      ELSE gross_amount_original
    END,
    gross_override_at = CASE
      WHEN v_expected IS NOT NULL THEN NOW()
      ELSE gross_override_at
    END,
    gross_override_by = CASE
      WHEN v_expected IS NOT NULL THEN auth.uid()
      ELSE gross_override_by
    END,
    gross_override_reason = CASE
      WHEN v_expected IS NOT NULL THEN 'acatado_esperado'
      ELSE gross_override_reason
    END
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', 'acatado',
      'status_anterior', v_status,
      'gross_anterior', v_gross,
      'gross_novo', COALESCE(v_expected, v_gross),
      'justificativa', _justification
    ));

  RETURN jsonb_build_object('ok', true, 'gross_anterior', v_gross, 'gross_novo', COALESCE(v_expected, v_gross));
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_accept_payment_item(_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_original text;
  v_gross_original numeric;
  v_gross_current numeric;
BEGIN
  SELECT ai_status::text, acatado_status_original, gross_amount_original, gross_amount
    INTO v_status, v_original, v_gross_original, v_gross_current
    FROM payment_items WHERE id = _item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF v_status <> 'acatado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não está acatado');
  END IF;

  UPDATE payment_items SET
    ai_status = COALESCE(v_original, 'reprovado')::item_ai_status,
    acatado_by = NULL,
    acatado_at = NULL,
    acatado_status_original = NULL,
    -- Restaura gross original quando havia override por acate.
    gross_amount = CASE
      WHEN gross_override_reason = 'acatado_esperado' AND gross_amount_original IS NOT NULL THEN gross_amount_original
      ELSE gross_amount
    END,
    gross_amount_original = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_amount_original
    END,
    gross_override_at = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_override_at
    END,
    gross_override_by = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_override_by
    END,
    gross_override_reason = CASE
      WHEN gross_override_reason = 'acatado_esperado' THEN NULL
      ELSE gross_override_reason
    END
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', 'acate_desfeito',
      'status_restaurado', COALESCE(v_original, 'reprovado'),
      'gross_restaurado', COALESCE(v_gross_original, v_gross_current)
    ));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

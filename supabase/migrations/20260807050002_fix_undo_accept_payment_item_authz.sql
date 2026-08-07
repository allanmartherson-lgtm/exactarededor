-- undo_accept_payment_item (SECURITY DEFINER, bypassa RLS) não checava
-- autenticação, papel nem hospital do item — qualquer usuário authenticated
-- podia desfazer o "acate" de qualquer payment_item de qualquer hospital,
-- restaurando ai_status e limpando a marcação de tratamento manual.
CREATE OR REPLACE FUNCTION public.undo_accept_payment_item(_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_payment_id uuid;
  v_hospital_id uuid;
  v_status text;
  v_original text;
  v_gross_original numeric;
  v_gross_current numeric;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Não autenticado');
  END IF;

  IF NOT (
    public.has_role(v_actor, 'admin'::app_role) OR public.has_role(v_actor, 'diretor'::app_role)
    OR public.has_role(v_actor, 'validador'::app_role) OR public.has_role(v_actor, 'analista'::app_role)
    OR public.has_role(v_actor, 'gestao_medica'::app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sem permissão para desfazer acate');
  END IF;

  SELECT payment_id, hospital_id INTO v_payment_id, v_hospital_id
    FROM public.payment_items WHERE id = _item_id;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  PERFORM public.assert_hospital_access(v_hospital_id);

  PERFORM pg_advisory_xact_lock(hashtextextended(v_payment_id::text, 0));

  SELECT ai_status::text, acatado_status_original, gross_amount_original, gross_amount
    INTO v_status, v_original, v_gross_original, v_gross_current
  FROM public.payment_items
  WHERE id = _item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  IF v_status <> 'acatado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não está acatado');
  END IF;

  UPDATE public.payment_items SET
    ai_status = COALESCE(v_original, 'reprovado')::item_ai_status,
    acatado_by = NULL,
    acatado_at = NULL,
    acatado_status_original = NULL,
    -- Desfazer o acate precisa remover também a marcação de tratamento manual:
    -- senão a reanálise cai no ramo `tratamento_manual` do motor e reaprova o
    -- item adotando o valor pago, anulando a reversão feita pelo analista.
    manual_intervention_reason_id = NULL,
    manual_intervention_by = NULL,
    manual_intervention_at = NULL,
    manual_intervention_notes = NULL,
    manual_intervention_source = NULL,
    manual_value_strategy = NULL,
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
  VALUES ('payment_item', _item_id, 'update', v_actor,
    jsonb_build_object(
      'event', 'acate_desfeito',
      'status_restaurado', COALESCE(v_original, 'reprovado'),
      'gross_restaurado', COALESCE(v_gross_original, v_gross_current),
      'tratamento_manual_limpo', true
    ));

  RETURN jsonb_build_object('ok', true);
END;
$function$;

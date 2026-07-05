
-- Substitui SELECT ... FOR UPDATE por pg_advisory_xact_lock(payment_id).
-- Advisory lock não interage com row locks ou triggers, garantindo ordem
-- consistente de aquisição em qualquer caminho concorrente (RPC de acatar,
-- edge functions de re-análise, recomputes) e eliminando o deadlock.

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
  v_payment_id uuid;
BEGIN
  SELECT payment_id INTO v_payment_id FROM payment_items WHERE id = _item_id;
  IF v_payment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  -- Advisory lock por lote: serializa acatar/undo/re-análise do mesmo pagamento
  -- sem depender de row locks (que estavam gerando deadlock com os triggers de
  -- sync de company_groups / financials / priority).
  PERFORM pg_advisory_xact_lock(hashtextextended(v_payment_id::text, 0));

  SELECT ai_status::text, gross_amount, expected_amount, (gross_override_at IS NOT NULL)
    INTO v_status, v_gross, v_expected, v_already_overridden
  FROM payment_items WHERE id = _item_id;

  IF v_status NOT IN ('reprovado', 'alerta') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      format('Não é possível acatar item com status "%s". Apenas reprovado ou alerta.', v_status));
  END IF;

  UPDATE payment_items SET
    acatado_status_original = ai_status::text,
    ai_status = 'acatado'::item_ai_status,
    acatado_by = auth.uid(),
    acatado_at = NOW(),
    gross_amount = CASE WHEN v_expected IS NOT NULL THEN v_expected ELSE gross_amount END,
    gross_amount_original = CASE
      WHEN v_expected IS NOT NULL AND NOT v_already_overridden THEN v_gross
      ELSE gross_amount_original
    END,
    gross_override_at = CASE WHEN v_expected IS NOT NULL THEN NOW() ELSE gross_override_at END,
    gross_override_by = CASE WHEN v_expected IS NOT NULL THEN auth.uid() ELSE gross_override_by END,
    gross_override_reason = CASE WHEN v_expected IS NOT NULL THEN 'acatado_esperado' ELSE gross_override_reason END
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

-- Mesma proteção via advisory lock em accept_payment_item_keep_paid.
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname='accept_payment_item_keep_paid' LIMIT 1;

  IF v_def IS NULL THEN RETURN; END IF;

  -- Remove eventual PERFORM ... FOR UPDATE anterior (linha inteira).
  v_new := regexp_replace(
    v_def,
    E'\\s*PERFORM 1 FROM payments[^;]+FOR UPDATE;\\s*',
    E'\n  ',
    'g'
  );

  -- Injeta advisory lock logo após o BEGIN.
  IF position('pg_advisory_xact_lock' IN v_new) = 0 THEN
    v_new := replace(
      v_new,
      E'BEGIN\n',
      E'BEGIN\n  PERFORM pg_advisory_xact_lock(hashtextextended((SELECT payment_id FROM payment_items WHERE id = _item_id)::text, 0));\n'
    );
  END IF;

  EXECUTE v_new;
END
$mig$;

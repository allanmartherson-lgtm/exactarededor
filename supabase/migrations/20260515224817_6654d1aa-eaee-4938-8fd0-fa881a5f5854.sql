-- 1. Novo valor no enum item_ai_status
ALTER TYPE item_ai_status ADD VALUE IF NOT EXISTS 'acatado';

-- 2. Campos de rastreabilidade no item
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS acatado_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS acatado_at timestamptz,
  ADD COLUMN IF NOT EXISTS acatado_status_original text;

-- 3. RPC: acatar item
CREATE OR REPLACE FUNCTION public.accept_payment_item(
  _item_id uuid,
  _justification text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT ai_status::text INTO v_status FROM payment_items WHERE id = _item_id;
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
    acatado_at = NOW()
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', 'acatado',
      'status_anterior', v_status,
      'justificativa', _justification
    ));

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.accept_payment_item(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_payment_item(uuid, text) TO authenticated;

-- 4. RPC: desfazer acate
CREATE OR REPLACE FUNCTION public.undo_accept_payment_item(_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_original text;
BEGIN
  SELECT ai_status::text, acatado_status_original
    INTO v_status, v_original
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
    acatado_status_original = NULL
  WHERE id = _item_id;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment_item', _item_id, 'update', auth.uid(),
    jsonb_build_object(
      'event', 'acate_desfeito',
      'status_restaurado', COALESCE(v_original, 'reprovado')
    ));

  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.undo_accept_payment_item(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.undo_accept_payment_item(uuid) TO authenticated;
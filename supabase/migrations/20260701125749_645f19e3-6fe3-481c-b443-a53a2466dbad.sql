CREATE OR REPLACE FUNCTION public.apply_zeev_bulk_manual(
  _item_ids uuid[],
  _reason_id uuid,
  _notes text,
  _source text DEFAULT 'zeev_bulk',
  _override_reason text DEFAULT 'zeev_bulk_manual'
)
RETURNS TABLE(updated_count int)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _actor uuid := auth.uid();
  _now timestamptz := now();
  _reason_code text;
  _count int := 0;
  _rec record;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _item_ids IS NULL OR array_length(_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no items provided';
  END IF;
  IF _reason_id IS NULL THEN
    RAISE EXCEPTION 'reason_id required';
  END IF;

  SELECT code INTO _reason_code FROM public.manual_intervention_reasons WHERE id = _reason_id;

  FOR _rec IN
    SELECT id, procedure_amount, gross_amount, gross_override_at
    FROM public.payment_items
    WHERE id = ANY(_item_ids)
    FOR UPDATE
  LOOP
    UPDATE public.payment_items pi
    SET
      manual_intervention_reason_id = _reason_id,
      manual_intervention_notes = NULLIF(btrim(_notes), ''),
      manual_intervention_by = _actor,
      manual_intervention_source = _source,
      ai_status = 'aprovado',
      expected_amount = CASE
        WHEN _rec.procedure_amount IS NOT NULL THEN _rec.procedure_amount
        ELSE pi.expected_amount
      END,
      gross_amount = CASE
        WHEN _rec.procedure_amount IS NOT NULL THEN _rec.procedure_amount
        ELSE pi.gross_amount
      END,
      gross_amount_original = CASE
        WHEN _rec.procedure_amount IS NOT NULL AND _rec.gross_override_at IS NULL THEN _rec.gross_amount
        ELSE pi.gross_amount_original
      END,
      gross_override_at = CASE
        WHEN _rec.procedure_amount IS NOT NULL THEN _now
        ELSE pi.gross_override_at
      END,
      gross_override_by = CASE
        WHEN _rec.procedure_amount IS NOT NULL THEN _actor
        ELSE pi.gross_override_by
      END,
      gross_override_reason = CASE
        WHEN _rec.procedure_amount IS NOT NULL THEN _override_reason
        ELSE pi.gross_override_reason
      END
    WHERE pi.id = _rec.id;

    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
    VALUES (
      'payment_item',
      _rec.id,
      'update',
      _actor,
      jsonb_build_object(
        '__op', jsonb_build_object('before', NULL, 'after', 'zeev_bulk_apply:' || COALESCE(_reason_code, _reason_id::text)),
        'manual_intervention_reason_id', jsonb_build_object('before', NULL, 'after', _reason_id)
      )
    );

    _count := _count + 1;
  END LOOP;

  RETURN QUERY SELECT _count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.apply_zeev_bulk_manual(uuid[], uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_zeev_bulk_manual(uuid[], uuid, text, text, text) TO authenticated;
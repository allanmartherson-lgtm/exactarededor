CREATE OR REPLACE FUNCTION public.apply_zeev_bulk_manual(
  _item_ids uuid[],
  _reason_id uuid,
  _notes text,
  _source text DEFAULT 'zeev_bulk',
  _override_reason text DEFAULT 'zeev_bulk_manual'
)
RETURNS TABLE(updated_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _actor uuid := auth.uid();
  _now timestamptz := now();
  _reason_code text;
  _count int := 0;
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

  -- Guard: apenas papéis operacionais podem aplicar tratativa em lote
  IF NOT (
    public.has_role(_actor, 'admin')
    OR public.has_role(_actor, 'diretor')
    OR public.has_role(_actor, 'validador')
    OR public.has_role(_actor, 'analista')
    OR public.has_role(_actor, 'gestao_medica')
  ) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT code INTO _reason_code FROM public.manual_intervention_reasons WHERE id = _reason_id;

  -- Set-based UPDATE (uma única passada) em vez de loop row-by-row.
  -- SECURITY DEFINER evita reavaliar policies RLS pesadas por linha.
  WITH updated AS (
    UPDATE public.payment_items pi
    SET
      manual_intervention_reason_id = _reason_id,
      manual_intervention_notes = NULLIF(btrim(_notes), ''),
      manual_intervention_by = _actor,
      manual_intervention_source = _source,
      ai_status = 'aprovado',
      expected_amount = CASE
        WHEN pi.procedure_amount IS NOT NULL THEN pi.procedure_amount
        ELSE pi.expected_amount
      END,
      gross_amount = CASE
        WHEN pi.procedure_amount IS NOT NULL THEN pi.procedure_amount
        ELSE pi.gross_amount
      END,
      gross_amount_original = CASE
        WHEN pi.procedure_amount IS NOT NULL AND pi.gross_override_at IS NULL THEN pi.gross_amount
        ELSE pi.gross_amount_original
      END,
      gross_override_at = CASE
        WHEN pi.procedure_amount IS NOT NULL THEN _now
        ELSE pi.gross_override_at
      END,
      gross_override_by = CASE
        WHEN pi.procedure_amount IS NOT NULL THEN _actor
        ELSE pi.gross_override_by
      END,
      gross_override_reason = CASE
        WHEN pi.procedure_amount IS NOT NULL THEN _override_reason
        ELSE pi.gross_override_reason
      END
    WHERE pi.id = ANY(_item_ids)
    RETURNING pi.id
  ),
  audit_ins AS (
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
    SELECT
      'payment_item',
      u.id,
      'update',
      _actor,
      jsonb_build_object(
        '__op', jsonb_build_object('before', NULL, 'after', 'zeev_bulk_apply:' || COALESCE(_reason_code, _reason_id::text)),
        'manual_intervention_reason_id', jsonb_build_object('before', NULL, 'after', _reason_id)
      )
    FROM updated u
    RETURNING 1
  )
  SELECT count(*)::int INTO _count FROM updated;

  RETURN QUERY SELECT _count;
END;
$function$;
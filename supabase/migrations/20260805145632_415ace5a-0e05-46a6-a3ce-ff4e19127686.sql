ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS manual_value_strategy text;

ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_manual_value_strategy_check;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_manual_value_strategy_check
  CHECK (manual_value_strategy IS NULL OR manual_value_strategy IN ('procedure','expected','custom'));

COMMENT ON COLUMN public.payment_items.manual_value_strategy IS
  'Estrategia de valor escolhida pelo analista no acate manual/Zeev em massa. O motor (rulesEngine, ramo tratamento_manual) respeita esta escolha em vez de inferir pela categoria do motivo.';

CREATE OR REPLACE FUNCTION public.apply_zeev_bulk_manual(_item_ids uuid[], _reason_id uuid, _notes text, _source text DEFAULT 'zeev_bulk'::text, _override_reason text DEFAULT 'zeev_bulk_manual'::text, _value_strategy text DEFAULT 'procedure'::text, _custom_value numeric DEFAULT NULL::numeric)
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
  _notes_clean text := NULLIF(btrim(_notes), '');
  _strategy text := lower(COALESCE(_value_strategy, 'procedure'));
BEGIN
  IF _actor IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _item_ids IS NULL OR array_length(_item_ids, 1) IS NULL THEN RAISE EXCEPTION 'no items provided'; END IF;
  IF _reason_id IS NULL THEN RAISE EXCEPTION 'reason_id required'; END IF;
  IF _strategy NOT IN ('procedure','expected','custom') THEN RAISE EXCEPTION 'invalid value_strategy: %', _strategy; END IF;
  IF _strategy = 'custom' AND (_custom_value IS NULL OR _custom_value < 0) THEN
    RAISE EXCEPTION 'custom value required and must be >= 0';
  END IF;

  IF NOT (
    public.has_role(_actor, 'admin') OR public.has_role(_actor, 'diretor')
    OR public.has_role(_actor, 'validador') OR public.has_role(_actor, 'analista')
    OR public.has_role(_actor, 'gestao_medica')
  ) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  SELECT code INTO _reason_code FROM public.manual_intervention_reasons WHERE id = _reason_id;

  WITH target AS (
    SELECT DISTINCT unnest(_item_ids) AS id
  ),
  updated AS (
    UPDATE public.payment_items pi
       SET manual_intervention_reason_id = _reason_id,
           manual_intervention_notes = _notes_clean,
           manual_intervention_by = _actor,
           manual_intervention_source = _source,
           ai_status = 'aprovado',
           -- Persiste a escolha do analista para que a reanalise posterior
           -- (rulesEngine, ramo tratamento_manual) nao a sobrescreva.
           manual_value_strategy = _strategy,
           -- Valoração só ocorre quando:
           --   (a) o item NAO tem acate explicito do usuario, e
           --   (b) o item TEM regra cadastrada (applied_calc_method).
           -- Caso contrario grava apenas a marcacao do motivo.
           expected_amount = CASE
             WHEN pi.gross_override_reason IN ('acatado_esperado','acatado_pago') THEN pi.expected_amount
             WHEN pi.applied_calc_method IS NULL THEN pi.expected_amount
             WHEN _strategy = 'procedure' THEN COALESCE(pi.procedure_amount, pi.expected_amount)
             WHEN _strategy = 'custom'    THEN _custom_value
             ELSE pi.expected_amount
           END,
           gross_amount = CASE
             WHEN pi.gross_override_reason IN ('acatado_esperado','acatado_pago') THEN pi.gross_amount
             WHEN pi.applied_calc_method IS NULL THEN pi.gross_amount
             WHEN _strategy = 'procedure' THEN COALESCE(pi.procedure_amount, pi.gross_amount)
             WHEN _strategy = 'custom'    THEN _custom_value
             ELSE pi.gross_amount
           END,
           gross_amount_original = CASE
             WHEN pi.gross_override_reason IN ('acatado_esperado','acatado_pago') THEN pi.gross_amount_original
             WHEN pi.applied_calc_method IS NULL THEN pi.gross_amount_original
             WHEN _strategy = 'procedure' AND pi.procedure_amount IS NOT NULL AND pi.gross_override_at IS NULL THEN pi.gross_amount
             WHEN _strategy = 'custom' AND pi.gross_override_at IS NULL THEN pi.gross_amount
             ELSE pi.gross_amount_original
           END,
           gross_override_at = CASE
             WHEN pi.gross_override_reason IN ('acatado_esperado','acatado_pago') THEN pi.gross_override_at
             WHEN pi.applied_calc_method IS NULL THEN pi.gross_override_at
             WHEN _strategy = 'procedure' AND pi.procedure_amount IS NOT NULL THEN _now
             WHEN _strategy = 'custom' THEN _now
             ELSE pi.gross_override_at
           END,
           gross_override_by = CASE
             WHEN pi.gross_override_reason IN ('acatado_esperado','acatado_pago') THEN pi.gross_override_by
             WHEN pi.applied_calc_method IS NULL THEN pi.gross_override_by
             WHEN _strategy = 'procedure' AND pi.procedure_amount IS NOT NULL THEN _actor
             WHEN _strategy = 'custom' THEN _actor
             ELSE pi.gross_override_by
           END,
           gross_override_reason = CASE
             WHEN pi.gross_override_reason IN ('acatado_esperado','acatado_pago') THEN pi.gross_override_reason
             WHEN pi.applied_calc_method IS NULL THEN pi.gross_override_reason
             WHEN _strategy = 'procedure' AND pi.procedure_amount IS NOT NULL THEN _override_reason
             WHEN _strategy = 'custom' THEN _override_reason || ':custom'
             ELSE pi.gross_override_reason
           END
      FROM target t
     WHERE pi.id = t.id
     RETURNING pi.id, pi.hospital_id, pi.applied_calc_method, pi.gross_override_reason
  ),
  audit_ins AS (
    INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, hospital_id, diff)
    SELECT 'payment_item', u.id, 'update', _actor, u.hospital_id,
           jsonb_build_object(
             '__op', jsonb_build_object(
               'before', NULL,
               'after', 'zeev_bulk_apply:' || COALESCE(_reason_code, _reason_id::text) || ':' || _strategy
             ),
             'manual_intervention_reason_id', jsonb_build_object('before', NULL, 'after', _reason_id),
             'value_strategy', jsonb_build_object('before', NULL, 'after', _strategy),
             'valoracao_bloqueada', to_jsonb(
               u.applied_calc_method IS NULL
               OR u.gross_override_reason IN ('acatado_esperado','acatado_pago')
             ),
             'custom_value', jsonb_build_object('before', NULL, 'after', to_jsonb(_custom_value))
           )
    FROM updated u
    RETURNING 1
  )
  SELECT count(*)::int INTO _count FROM audit_ins;

  RETURN QUERY SELECT _count;
END;
$function$;
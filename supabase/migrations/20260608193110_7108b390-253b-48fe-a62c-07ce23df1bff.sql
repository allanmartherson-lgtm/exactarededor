CREATE OR REPLACE FUNCTION public.cancel_company_group_payment(p_group_id uuid, p_reason payment_cancellation_reason, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_old_status text;
  v_items_affected int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  PERFORM public._assert_can_cancel_group(p_group_id);

  SELECT payment_id, company_id, status::text INTO v_payment_id, v_company_id, v_old_status
  FROM public.payment_company_groups WHERE id = p_group_id;

  IF v_old_status = 'cancelado' THEN RAISE EXCEPTION 'group_already_cancelled'; END IF;

  UPDATE public.payment_company_groups
     SET status = 'cancelado'::payment_status,
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = p_reason,
         cancellation_note = p_note,
         cancellation_reactivated_at = NULL,
         cancellation_reactivated_by = NULL,
         updated_at = now()
   WHERE id = p_group_id;

  WITH upd AS (
    UPDATE public.payment_items pi
       SET is_cancelled = true,
           cancelled_at = now(),
           cancelled_by = v_uid,
           cancellation_reason = p_reason,
           cancellation_note = COALESCE(p_note, 'Cancelado em cascata pelo grupo'),
           cancellation_reactivated_at = NULL,
           cancellation_reactivated_by = NULL
     WHERE pi.payment_id = v_payment_id
       AND pi.company_id = v_company_id
       AND pi.is_cancelled = false
    RETURNING 1
  ) SELECT count(*) INTO v_items_affected FROM upd;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, company_id, diff, hospital_id)
  SELECT v_uid,
         'deactivated',
         'payment',
         v_payment_id,
         v_company_id,
         jsonb_build_object(
           'operation', 'cancel_company_group_payment',
           'group_id', p_group_id,
           'reason', p_reason,
           'note', p_note,
           'items_affected', v_items_affected
         ),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'items_affected', v_items_affected);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_item_payment(p_item_id uuid, p_reason payment_cancellation_reason, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_group_id uuid;
  v_total int := 0;
  v_cancel int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT pi.payment_id, pi.company_id INTO v_payment_id, v_company_id
  FROM public.payment_items pi WHERE pi.id = p_item_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;

  SELECT id INTO v_group_id FROM public.payment_company_groups
   WHERE payment_id = v_payment_id AND company_id = v_company_id LIMIT 1;

  IF v_group_id IS NOT NULL THEN
    PERFORM public._assert_can_cancel_group(v_group_id);
  END IF;

  UPDATE public.payment_items
     SET is_cancelled = true,
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = p_reason,
         cancellation_note = p_note,
         cancellation_reactivated_at = NULL,
         cancellation_reactivated_by = NULL
   WHERE id = p_item_id AND is_cancelled = false;

  IF v_group_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE is_cancelled)
      INTO v_total, v_cancel
      FROM public.payment_items
     WHERE payment_id = v_payment_id AND company_id = v_company_id;

    IF v_total > 0 AND v_cancel = v_total THEN
      UPDATE public.payment_company_groups
         SET status = 'cancelado'::payment_status,
             cancelled_at = COALESCE(cancelled_at, now()),
             cancelled_by = COALESCE(cancelled_by, v_uid),
             cancellation_reason = COALESCE(cancellation_reason, p_reason),
             cancellation_note = COALESCE(cancellation_note, 'Cancelado automaticamente — todos os itens cancelados'),
             updated_at = now()
       WHERE id = v_group_id AND status <> 'cancelado'::payment_status;
    END IF;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, company_id, diff, hospital_id)
  SELECT v_uid,
         'deactivated',
         'payment_item',
         p_item_id,
         v_company_id,
         jsonb_build_object(
           'operation', 'cancel_item_payment',
           'group_id', v_group_id,
           'reason', p_reason,
           'note', p_note,
           'group_promoted', (v_total > 0 AND v_cancel = v_total)
         ),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'group_promoted', (v_total > 0 AND v_cancel = v_total));
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_cancelled_group(p_group_id uuid, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_p_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT g.payment_id, g.company_id, p.status::text
    INTO v_payment_id, v_company_id, v_p_status
  FROM public.payment_company_groups g
  JOIN public.payments p ON p.id = g.payment_id
  WHERE g.id = p_group_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;
  IF v_p_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_reactivate_paid_payment';
  END IF;

  UPDATE public.payment_company_groups
     SET status = 'em_analise_ia'::payment_status,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid,
         updated_at = now()
   WHERE id = p_group_id AND status = 'cancelado'::payment_status;

  UPDATE public.payment_items
     SET is_cancelled = false,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid
   WHERE payment_id = v_payment_id
     AND company_id = v_company_id
     AND is_cancelled = true;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, company_id, diff, hospital_id)
  SELECT v_uid,
         'reactivated',
         'payment',
         v_payment_id,
         v_company_id,
         jsonb_build_object(
           'operation', 'reactivate_cancelled_group',
           'group_id', p_group_id,
           'note', p_note
         ),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reactivate_cancelled_item(p_item_id uuid, p_note text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_payment_id uuid;
  v_company_id uuid;
  v_p_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT pi.payment_id, pi.company_id, p.status::text INTO v_payment_id, v_company_id, v_p_status
  FROM public.payment_items pi
  JOIN public.payments p ON p.id = pi.payment_id
  WHERE pi.id = p_item_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'item_not_found'; END IF;
  IF v_p_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_reactivate_paid_payment';
  END IF;

  UPDATE public.payment_items
     SET is_cancelled = false,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid
   WHERE id = p_item_id AND is_cancelled = true;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, company_id, diff, hospital_id)
  SELECT v_uid,
         'reactivated',
         'payment_item',
         p_item_id,
         v_company_id,
         jsonb_build_object(
           'operation', 'reactivate_cancelled_item',
           'note', p_note
         ),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

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
  v_total int; v_cancel int;
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
         SET cancellation_previous_status = COALESCE(cancellation_previous_status, status),
             status = 'cancelado'::payment_status,
             cancelled_at = COALESCE(cancelled_at, now()),
             cancelled_by = COALESCE(cancelled_by, v_uid),
             cancellation_reason = COALESCE(cancellation_reason, p_reason),
             cancellation_note = COALESCE(cancellation_note, 'Cancelado automaticamente — todos os itens cancelados'),
             updated_at = now()
       WHERE id = v_group_id AND status <> 'cancelado'::payment_status;
    END IF;
  END IF;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, diff, hospital_id, company_id)
  SELECT v_uid, 'deleted', 'payment_item', p_item_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'group_promoted', (v_total > 0 AND v_cancel = v_total), 'op', 'cancel_item_payment'),
         p.hospital_id, v_company_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'group_promoted', (v_total > 0 AND v_cancel = v_total));
END;
$function$;

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
  v_prev_status payment_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  PERFORM public._assert_can_cancel_group(p_group_id);

  SELECT payment_id, company_id, status
    INTO v_payment_id, v_company_id, v_prev_status
    FROM public.payment_company_groups
   WHERE id = p_group_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;
  IF v_prev_status = 'cancelado'::payment_status THEN RAISE EXCEPTION 'already_cancelled'; END IF;

  UPDATE public.payment_items
     SET is_cancelled = true,
         cancelled_at = COALESCE(cancelled_at, now()),
         cancelled_by = COALESCE(cancelled_by, v_uid),
         cancellation_reason = COALESCE(cancellation_reason, p_reason),
         cancellation_note = COALESCE(cancellation_note, p_note)
   WHERE payment_id = v_payment_id AND company_id = v_company_id AND is_cancelled = false;

  UPDATE public.payment_company_groups
     SET cancellation_previous_status = v_prev_status,
         status = 'cancelado'::payment_status,
         cancelled_at = now(),
         cancelled_by = v_uid,
         cancellation_reason = p_reason,
         cancellation_note = p_note,
         updated_at = now()
   WHERE id = p_group_id;

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, diff, hospital_id, company_id)
  SELECT v_uid, 'deleted', 'payment', p_group_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'previous_status', v_prev_status, 'op', 'cancel_company_group_payment'),
         p.hospital_id, v_company_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

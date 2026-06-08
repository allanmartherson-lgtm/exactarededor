ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS cancellation_previous_status public.payment_status;

CREATE OR REPLACE FUNCTION public.cancel_company_group_payment(
  p_group_id uuid,
  p_reason public.payment_cancellation_reason,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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
     SET cancellation_previous_status = status,
         status = 'cancelado'::payment_status,
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

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  SELECT v_uid, 'cancel_company_group_payment', 'payment_company_groups', p_group_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'items_affected', v_items_affected, 'previous_status', v_old_status),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'items_affected', v_items_affected);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_item_payment(
  p_item_id uuid,
  p_reason public.payment_cancellation_reason,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  SELECT v_uid, 'cancel_item_payment', 'payment_items', p_item_id,
         jsonb_build_object('reason', p_reason, 'note', p_note, 'group_promoted', (v_total > 0 AND v_cancel = v_total)),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'group_promoted', (v_total > 0 AND v_cancel = v_total));
END;
$$;

-- Mantém a assinatura existente (p_run_id primeiro)
CREATE OR REPLACE FUNCTION public.cancel_by_reconciliation(
  p_run_id uuid,
  p_payment_id uuid,
  p_scope jsonb,
  p_reason public.payment_cancellation_reason,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hospital uuid;
  v_payment_status text;
  v_scope_mode text;
  v_target_ids uuid[];
  v_company_id uuid;
  v_items_affected int := 0;
  v_groups_affected int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT hospital_id, status::text INTO v_hospital, v_payment_status
  FROM public.payments WHERE id = p_payment_id;

  IF v_payment_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_cancel_paid_payment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.invoices
     WHERE payment_id = p_payment_id
       AND status IN ('nf_recebida','nf_conciliada','lancado')
  ) THEN
    RAISE EXCEPTION 'cannot_cancel_with_invoices';
  END IF;

  v_scope_mode := p_scope->>'mode';

  IF v_scope_mode = 'company' THEN
    v_company_id := (p_scope->>'company_id')::uuid;
    SELECT array_agg(pi.id) INTO v_target_ids
      FROM public.payment_items pi
     WHERE pi.payment_id = p_payment_id
       AND pi.company_id = v_company_id
       AND pi.is_cancelled = false;
  ELSIF v_scope_mode = 'items' THEN
    SELECT array_agg((value)::uuid) INTO v_target_ids
      FROM jsonb_array_elements_text(p_scope->'item_ids');
  ELSIF v_scope_mode = 'all' THEN
    SELECT array_agg(pi.id) INTO v_target_ids
      FROM public.payment_items pi
     WHERE pi.payment_id = p_payment_id
       AND pi.is_cancelled = false;
  ELSE
    RAISE EXCEPTION 'invalid_scope';
  END IF;

  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'items_affected', 0, 'groups_affected', 0, 'note', 'no_targets');
  END IF;

  WITH upd AS (
    UPDATE public.payment_items
       SET is_cancelled = true,
           cancelled_at = now(),
           cancelled_by = v_uid,
           cancellation_reason = p_reason,
           cancellation_note = COALESCE(p_note, 'Cancelado via conciliação'),
           cancellation_source = 'reconciliacao',
           reconciliation_run_id = p_run_id,
           cancellation_reactivated_at = NULL,
           cancellation_reactivated_by = NULL
     WHERE id = ANY(v_target_ids)
       AND is_cancelled = false
    RETURNING 1
  ) SELECT count(*) INTO v_items_affected FROM upd;

  WITH grp_upd AS (
    UPDATE public.payment_company_groups g
       SET cancellation_previous_status = COALESCE(g.cancellation_previous_status, g.status),
           status = 'cancelado'::payment_status,
           cancelled_at = COALESCE(g.cancelled_at, now()),
           cancelled_by = COALESCE(g.cancelled_by, v_uid),
           cancellation_reason = COALESCE(g.cancellation_reason, p_reason),
           cancellation_note = COALESCE(g.cancellation_note, 'Cancelado via conciliação'),
           cancellation_source = COALESCE(g.cancellation_source, 'reconciliacao'),
           reconciliation_run_id = COALESCE(g.reconciliation_run_id, p_run_id),
           updated_at = now()
     WHERE g.payment_id = p_payment_id
       AND g.status <> 'cancelado'::payment_status
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = g.payment_id
            AND pi.company_id = g.company_id
            AND pi.is_cancelled = false
       )
       AND EXISTS (
         SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = g.payment_id
            AND pi.company_id = g.company_id
       )
    RETURNING 1
  ) SELECT count(*) INTO v_groups_affected FROM grp_upd;

  UPDATE public.reconciliation_items ri
     SET cancelled = true
   WHERE ri.run_id = p_run_id
     AND ri.payment_item_id = ANY(v_target_ids);

  INSERT INTO public.audit_log(actor_id, action, entity, entity_id, details, hospital_id)
  VALUES (v_uid, 'cancel_by_reconciliation', 'payments', p_payment_id,
          jsonb_build_object('run_id', p_run_id, 'scope', p_scope, 'reason', p_reason, 'note', p_note,
                             'items_affected', v_items_affected, 'groups_affected', v_groups_affected),
          v_hospital);

  RETURN jsonb_build_object('ok', true, 'items_affected', v_items_affected, 'groups_affected', v_groups_affected);
END;
$$;

CREATE OR REPLACE FUNCTION public.reactivate_cancelled_group(p_group_id uuid, p_note text DEFAULT NULL)
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
  v_was_cancelled boolean;
  v_prev_status public.payment_status;
  v_restored_status public.payment_status;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT g.payment_id, g.company_id, p.status::text,
         (g.status = 'cancelado'::payment_status OR g.cancelled_at IS NOT NULL),
         g.cancellation_previous_status
    INTO v_payment_id, v_company_id, v_p_status, v_was_cancelled, v_prev_status
  FROM public.payment_company_groups g
  JOIN public.payments p ON p.id = g.payment_id
  WHERE g.id = p_group_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;
  IF NOT v_was_cancelled THEN RAISE EXCEPTION 'group_not_cancelled'; END IF;
  IF v_p_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_reactivate_paid_payment';
  END IF;

  v_restored_status := COALESCE(NULLIF(v_prev_status, 'cancelado'::payment_status), 'em_analise_ia'::payment_status);

  UPDATE public.payment_company_groups
     SET status = v_restored_status,
         cancelled_at = NULL,
         cancelled_by = NULL,
         cancellation_reason = NULL,
         cancellation_note = NULL,
         cancellation_source = NULL,
         cancellation_previous_status = NULL,
         reconciliation_run_id = NULL,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid,
         updated_at = now()
   WHERE id = p_group_id;

  UPDATE public.payment_items
     SET is_cancelled = false,
         cancelled_at = NULL,
         cancelled_by = NULL,
         cancellation_reason = NULL,
         cancellation_note = NULL,
         cancellation_source = NULL,
         reconciliation_run_id = NULL,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid
   WHERE payment_id = v_payment_id
     AND company_id = v_company_id
     AND (is_cancelled = true OR cancelled_at IS NOT NULL);

  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, company_id, diff, hospital_id)
  SELECT v_uid,
         'reactivated',
         'payment',
         v_payment_id,
         v_company_id,
         jsonb_build_object(
           'operation', 'reactivate_cancelled_group',
           'group_id', p_group_id,
           'restored_status', v_restored_status,
           'previous_status_captured', v_prev_status,
           'note', p_note
         ),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true, 'restored_status', v_restored_status);
END;
$function$;
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

  -- Limpa os campos de cancelamento para o banner/UI saírem ao vivo via Realtime.
  -- A trilha de auditoria fica em cancellation_reactivated_at/by + audit_log.
  UPDATE public.payment_company_groups
     SET status = 'em_analise_ia'::payment_status,
         cancelled_at = NULL,
         cancelled_by = NULL,
         cancellation_reason = NULL,
         cancellation_note = NULL,
         cancellation_source = NULL,
         reconciliation_run_id = NULL,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid,
         updated_at = now()
   WHERE id = p_group_id AND status = 'cancelado'::payment_status;

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
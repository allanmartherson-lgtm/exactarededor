-- finalize_ai_retry
CREATE OR REPLACE FUNCTION public.finalize_ai_retry(p_id uuid, p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_hospital_access((SELECT p.hospital_id FROM public.ai_retry_queue r JOIN public.payments p ON p.id=r.payment_id WHERE r.id = p_id));
  UPDATE public.ai_retry_queue
  SET
    status = CASE
      WHEN p_success THEN 'done'
      WHEN attempts >= max_attempts THEN 'failed'
      ELSE 'pending'
    END,
    last_error = CASE WHEN p_success THEN NULL ELSE LEFT(COALESCE(p_error, last_error), 1000) END,
    next_attempt_at = CASE
      WHEN p_success OR attempts >= max_attempts THEN next_attempt_at
      ELSE now() + (LEAST(30, GREATEST(1, POWER(2, attempts)::int)) || ' minutes')::interval
    END,
    finished_at = CASE WHEN p_success OR attempts >= max_attempts THEN now() ELSE NULL END,
    locked_at = NULL
  WHERE id = p_id;
END;
$function$;

-- finalize_confeccao
CREATE OR REPLACE FUNCTION public.finalize_confeccao(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  pay public.payments%ROWTYPE;
BEGIN
  PERFORM public.assert_hospital_access((SELECT hospital_id FROM public.payments WHERE id = _payment_id));
  SELECT * INTO pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pagamento % não encontrado', _payment_id;
  END IF;
  IF pay.analysis_mode IS DISTINCT FROM 'confeccao' THEN
    RAISE EXCEPTION 'Pagamento % não está em modo confecção (mode=%)', _payment_id, pay.analysis_mode;
  END IF;
  UPDATE public.payment_company_groups
  SET confeccao_status = 'confeccao_concluida',
      confeccao_finalized_at = COALESCE(confeccao_finalized_at, now()),
      confeccao_finalized_by = COALESCE(confeccao_finalized_by, uid),
      updated_at = now()
  WHERE payment_id = _payment_id
    AND (confeccao_status IS NULL OR confeccao_status = 'em_confeccao');
  PERFORM set_config('app.allow_payment_status_write', 'on', true);
  UPDATE public.payments
  SET analysis_mode = 'padrao',
      confeccao_status = 'confeccao_concluida',
      confeccao_finalized_at = COALESCE(confeccao_finalized_at, now()),
      confeccao_finalized_by = COALESCE(confeccao_finalized_by, uid),
      status = 'em_analise_ia',
      updated_at = now()
  WHERE id = _payment_id;
  PERFORM set_config('app.allow_payment_status_write', 'off', true);
  UPDATE public.payment_company_groups
  SET status = 'revisao_analista',
      updated_at = now()
  WHERE payment_id = _payment_id
    AND status IN ('rascunho');
  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES ('payment', _payment_id, 'updated', uid,
          jsonb_build_object(
            'event', 'confeccao_finalizada',
            'from_mode', 'confeccao',
            'to_mode', 'padrao'
          ));
END;
$function$;

-- reactivate_cancelled_group
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
  v_was_cancelled boolean;
BEGIN
  PERFORM public.assert_hospital_access((SELECT p.hospital_id FROM public.payment_company_groups g JOIN public.payments p ON p.id=g.payment_id WHERE g.id = p_group_id));
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT public._can_cancel_payment(v_uid) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT g.payment_id, g.company_id, p.status::text,
         (g.status = 'cancelado'::payment_status OR g.cancelled_at IS NOT NULL)
    INTO v_payment_id, v_company_id, v_p_status, v_was_cancelled
  FROM public.payment_company_groups g
  JOIN public.payments p ON p.id = g.payment_id
  WHERE g.id = p_group_id;
  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;
  IF NOT v_was_cancelled THEN RAISE EXCEPTION 'group_not_cancelled'; END IF;
  IF v_p_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_reactivate_paid_payment';
  END IF;
  UPDATE public.payment_company_groups
     SET status = CASE WHEN status = 'cancelado'::payment_status
                       THEN 'em_analise_ia'::payment_status
                       ELSE status END,
         cancelled_at = NULL, cancelled_by = NULL,
         cancellation_reason = NULL, cancellation_note = NULL,
         cancellation_source = NULL, reconciliation_run_id = NULL,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid,
         updated_at = now()
   WHERE id = p_group_id;
  UPDATE public.payment_items
     SET is_cancelled = false,
         cancelled_at = NULL, cancelled_by = NULL,
         cancellation_reason = NULL, cancellation_note = NULL,
         cancellation_source = NULL, reconciliation_run_id = NULL,
         cancellation_reactivated_at = now(),
         cancellation_reactivated_by = v_uid
   WHERE payment_id = v_payment_id
     AND company_id = v_company_id
     AND (is_cancelled = true OR cancelled_at IS NOT NULL)
     AND COALESCE(cancellation_source, 'manual') = 'manual';
  INSERT INTO public.audit_log(actor_id, action, entity_type, entity_id, company_id, diff, hospital_id)
  SELECT v_uid, 'reactivated', 'payment', v_payment_id, v_company_id,
         jsonb_build_object('operation','reactivate_cancelled_group','group_id',p_group_id,'note',p_note),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- reactivate_cancelled_item
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
  PERFORM public.assert_hospital_access((SELECT p.hospital_id FROM public.payment_items i JOIN public.payments p ON p.id=i.payment_id WHERE i.id = p_item_id));
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
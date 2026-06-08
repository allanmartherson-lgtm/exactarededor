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

  -- Idempotente: limpa marcas de cancelamento mesmo que o status já tenha sido alterado.
  UPDATE public.payment_company_groups
     SET status = CASE WHEN status = 'cancelado'::payment_status
                       THEN 'em_analise_ia'::payment_status
                       ELSE status END,
         cancelled_at = NULL,
         cancelled_by = NULL,
         cancellation_reason = NULL,
         cancellation_note = NULL,
         cancellation_source = NULL,
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
           'note', p_note
         ),
         p.hospital_id
  FROM public.payments p WHERE p.id = v_payment_id;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Limpa órfãos existentes: grupos não-cancelados com cancelled_at preenchido
UPDATE public.payment_company_groups
   SET cancelled_at = NULL,
       cancelled_by = NULL,
       cancellation_reason = NULL,
       cancellation_note = NULL,
       cancellation_source = NULL,
       reconciliation_run_id = NULL
 WHERE status <> 'cancelado'::payment_status
   AND cancelled_at IS NOT NULL;

UPDATE public.payment_items i
   SET is_cancelled = false,
       cancelled_at = NULL,
       cancelled_by = NULL,
       cancellation_reason = NULL,
       cancellation_note = NULL,
       cancellation_source = NULL,
       reconciliation_run_id = NULL
  FROM public.payment_company_groups g
 WHERE g.payment_id = i.payment_id
   AND g.company_id = i.company_id
   AND g.status <> 'cancelado'::payment_status
   AND (i.is_cancelled = true OR i.cancelled_at IS NOT NULL);
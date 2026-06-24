ALTER FUNCTION public.admin_delete_payment(uuid) SET lock_timeout TO '0';

-- Adiciona advisory lock no início para serializar deletes concorrentes do mesmo lote
CREATE OR REPLACE FUNCTION public.admin_delete_payment(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '0'
SET lock_timeout TO '0'
AS $function$
BEGIN
  -- Serializa deletes concorrentes do mesmo lote (evita deadlock em retries).
  PERFORM pg_advisory_xact_lock(hashtext('admin_delete_payment:' || _payment_id::text));

  UPDATE public.doctor_messages SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);

  UPDATE public.reconciliation_items SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);

  UPDATE public.reconciliation_items SET applied_payment_item_id = NULL
   WHERE applied_payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);

  UPDATE public.glosa_items SET matched_payment_item_id = NULL
   WHERE matched_payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);

  UPDATE public.production_validation_feedbacks SET payment_item_id = NULL
   WHERE payment_item_id IN (SELECT id FROM public.payment_items WHERE payment_id = _payment_id);

  UPDATE public.doctor_messages SET payment_id = NULL WHERE payment_id = _payment_id;
  UPDATE public.glosa_debts SET last_payment_id = NULL WHERE last_payment_id = _payment_id;
  UPDATE public.glosa_items SET applied_payment_id = NULL WHERE applied_payment_id = _payment_id;
  UPDATE public.glosa_items SET matched_payment_id = NULL WHERE matched_payment_id = _payment_id;
  UPDATE public.pendencias SET payment_id = NULL WHERE payment_id = _payment_id;
  UPDATE public.reconciliation_items SET applied_payment_id = NULL WHERE applied_payment_id = _payment_id;
  UPDATE public.user_company_notes SET payment_id = NULL WHERE payment_id = _payment_id;

  DELETE FROM public.user_company_notes
   WHERE group_id IN (SELECT id FROM public.payment_company_groups WHERE payment_id = _payment_id);

  DELETE FROM public.payment_unmatched_items WHERE payment_id = _payment_id;
  DELETE FROM public.payment_items           WHERE payment_id = _payment_id;
  DELETE FROM public.payment_observations    WHERE payment_id = _payment_id;
  DELETE FROM public.payment_company_groups  WHERE payment_id = _payment_id;
  DELETE FROM public.payments                WHERE id = _payment_id;
END;
$function$;
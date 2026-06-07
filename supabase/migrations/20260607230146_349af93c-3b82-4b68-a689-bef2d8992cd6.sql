CREATE INDEX IF NOT EXISTS idx_user_company_notes_group_id
  ON public.user_company_notes(group_id);

CREATE INDEX IF NOT EXISTS idx_doctor_messages_payment_item_id
  ON public.doctor_messages(payment_item_id);

CREATE INDEX IF NOT EXISTS idx_glosa_items_matched_payment_item_id
  ON public.glosa_items(matched_payment_item_id);

CREATE INDEX IF NOT EXISTS idx_production_validation_feedbacks_payment_item_id
  ON public.production_validation_feedbacks(payment_item_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_items_applied_payment_item_id
  ON public.reconciliation_items(applied_payment_item_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_items_payment_item_id
  ON public.reconciliation_items(payment_item_id);

CREATE INDEX IF NOT EXISTS idx_glosa_debts_last_payment_id
  ON public.glosa_debts(last_payment_id);

CREATE INDEX IF NOT EXISTS idx_glosa_items_applied_payment_id
  ON public.glosa_items(applied_payment_id);

CREATE INDEX IF NOT EXISTS idx_glosa_items_matched_payment_id
  ON public.glosa_items(matched_payment_id);

CREATE INDEX IF NOT EXISTS idx_notification_queue_payment_id
  ON public.notification_queue(payment_id);

CREATE INDEX IF NOT EXISTS idx_pendencias_payment_id
  ON public.pendencias(payment_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_items_applied_payment_id
  ON public.reconciliation_items(applied_payment_id);

CREATE INDEX IF NOT EXISTS idx_user_company_notes_payment_id
  ON public.user_company_notes(payment_id);

CREATE OR REPLACE FUNCTION public.admin_delete_payment(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '0'
AS $$
BEGIN
  -- Remove/destaca dependências sem cascade para evitar bloqueio por FK
  -- e reduzir trabalho implícito no DELETE do lote.
  UPDATE public.doctor_messages
     SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items WHERE payment_id = _payment_id
   );

  UPDATE public.reconciliation_items
     SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items WHERE payment_id = _payment_id
   );

  UPDATE public.reconciliation_items
     SET applied_payment_item_id = NULL
   WHERE applied_payment_item_id IN (
     SELECT id FROM public.payment_items WHERE payment_id = _payment_id
   );

  UPDATE public.glosa_items
     SET matched_payment_item_id = NULL
   WHERE matched_payment_item_id IN (
     SELECT id FROM public.payment_items WHERE payment_id = _payment_id
   );

  UPDATE public.production_validation_feedbacks
     SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items WHERE payment_id = _payment_id
   );

  UPDATE public.doctor_messages
     SET payment_id = NULL
   WHERE payment_id = _payment_id;

  UPDATE public.glosa_debts
     SET last_payment_id = NULL
   WHERE last_payment_id = _payment_id;

  UPDATE public.glosa_items
     SET applied_payment_id = NULL
   WHERE applied_payment_id = _payment_id;

  UPDATE public.glosa_items
     SET matched_payment_id = NULL
   WHERE matched_payment_id = _payment_id;

  UPDATE public.pendencias
     SET payment_id = NULL
   WHERE payment_id = _payment_id;

  UPDATE public.reconciliation_items
     SET applied_payment_id = NULL
   WHERE applied_payment_id = _payment_id;

  UPDATE public.user_company_notes
     SET payment_id = NULL
   WHERE payment_id = _payment_id;

  DELETE FROM public.user_company_notes
   WHERE group_id IN (
     SELECT id FROM public.payment_company_groups WHERE payment_id = _payment_id
   );

  DELETE FROM public.payment_items          WHERE payment_id = _payment_id;
  DELETE FROM public.payment_observations   WHERE payment_id = _payment_id;
  DELETE FROM public.payment_company_groups WHERE payment_id = _payment_id;
  DELETE FROM public.payments               WHERE id = _payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment(uuid) TO service_role;
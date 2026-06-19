
CREATE OR REPLACE FUNCTION public.admin_clear_company_items(
  _payment_id uuid,
  _company_name text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '0'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  -- Destaca referências externas para não bloquear o DELETE em cascata
  UPDATE public.doctor_messages
     SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = _payment_id AND company_name = _company_name
   );

  UPDATE public.reconciliation_items
     SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = _payment_id AND company_name = _company_name
   );

  UPDATE public.reconciliation_items
     SET applied_payment_item_id = NULL
   WHERE applied_payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = _payment_id AND company_name = _company_name
   );

  UPDATE public.glosa_items
     SET matched_payment_item_id = NULL
   WHERE matched_payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = _payment_id AND company_name = _company_name
   );

  UPDATE public.production_validation_feedbacks
     SET payment_item_id = NULL
   WHERE payment_item_id IN (
     SELECT id FROM public.payment_items
      WHERE payment_id = _payment_id AND company_name = _company_name
   );

  WITH del AS (
    DELETE FROM public.payment_items
     WHERE payment_id = _payment_id
       AND company_name = _company_name
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_company_items(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_clear_company_items(uuid, text) TO service_role;

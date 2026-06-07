CREATE OR REPLACE FUNCTION public.admin_delete_payment(_payment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lotes grandes (centenas de itens + cascades + triggers) excedem o
  -- statement_timeout padrão do PostgREST/edge runtime. Zeramos só nesta
  -- transação.
  PERFORM set_config('statement_timeout', '0', true);

  DELETE FROM public.payment_items          WHERE payment_id = _payment_id;
  DELETE FROM public.payment_observations   WHERE payment_id = _payment_id;
  DELETE FROM public.payment_company_groups WHERE payment_id = _payment_id;
  DELETE FROM public.payments               WHERE id        = _payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment(uuid) TO service_role;
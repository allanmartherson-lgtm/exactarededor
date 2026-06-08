CREATE OR REPLACE FUNCTION public._validate_cancel_target(_group_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_payment_id uuid;
  v_status text;
  v_has_nf boolean;
BEGIN
  SELECT g.payment_id, p.status::text
    INTO v_payment_id, v_status
  FROM public.payment_company_groups g
  JOIN public.payments p ON p.id = g.payment_id
  WHERE g.id = _group_id;

  IF v_payment_id IS NULL THEN RAISE EXCEPTION 'group_not_found'; END IF;

  IF v_status IN ('pago','lancado','arquivado') THEN
    RAISE EXCEPTION 'cannot_cancel_paid_payment';
  END IF;

  -- Bloqueia se houver NF ativa (recebida/conciliada). 'aguardando', 'divergente' e 'cancelada' não bloqueiam.
  SELECT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE payment_id = v_payment_id
      AND status IN ('recebida','conciliada')
  ) INTO v_has_nf;

  IF v_has_nf THEN
    RAISE EXCEPTION 'cannot_cancel_with_active_invoice';
  END IF;
END;
$$;
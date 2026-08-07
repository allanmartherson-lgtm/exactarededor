CREATE OR REPLACE FUNCTION public.mark_invoice_lancada(
  p_invoice_id uuid,
  p_erp_document_number text
)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.invoices;
  v_doc text := btrim(COALESCE(p_erp_document_number, ''));
  v_actor text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'analista'::public.app_role)
          OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Ação restrita a analista ou administrador.' USING ERRCODE = '42501';
  END IF;
  IF v_doc = '' THEN
    RAISE EXCEPTION 'Número do documento no P12 é obrigatório.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access_hospital(v_inv.hospital_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'conciliada'::public.invoice_status THEN
    RAISE EXCEPTION 'Somente notas conciliadas podem ser lançadas no P12 (status atual: %).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
     SET status = 'lancada'::public.invoice_status,
         erp_document_number = v_doc,
         erp_posted_at = now(),
         erp_posted_by = v_uid,
         updated_at = now()
   WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  IF v_inv.company_group_id IS NOT NULL THEN
    UPDATE public.payment_company_groups
       SET status = 'lancado'::public.payment_status,
           updated_at = now()
     WHERE id = v_inv.company_group_id
       AND status <> 'lancado'::public.payment_status;
  END IF;

  SELECT COALESCE(full_name, email, v_uid::text) INTO v_actor
    FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.payment_observations
    (hospital_id, payment_id, author_type, author_id, message, observation_type)
  VALUES (
    v_inv.hospital_id, v_inv.payment_id, 'sistema'::public.observation_author, v_uid,
    format('NF #%s lançada no P12 (doc %s) por %s',
           COALESCE(v_inv.invoice_number, '—'), v_doc, COALESCE(v_actor, 'usuário')),
    'informativo'::public.observation_type
  );

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_invoice_lancada(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_lancada(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_invoice_paga(p_invoice_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.invoices;
  v_pending int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'analista'::public.app_role)
          OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Ação restrita a analista ou administrador.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access_hospital(v_inv.hospital_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'lancada'::public.invoice_status THEN
    RAISE EXCEPTION 'Somente notas lançadas no P12 podem ser marcadas como pagas (status atual: %).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
     SET status = 'paga'::public.invoice_status,
         paid_at = now(),
         paid_by = v_uid,
         updated_at = now()
   WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  SELECT count(*) INTO v_pending
    FROM public.invoices i
   WHERE i.payment_id = v_inv.payment_id
     AND i.status <> 'cancelada'::public.invoice_status
     AND i.status <> 'paga'::public.invoice_status;

  IF v_pending = 0 THEN
    UPDATE public.payments
       SET status = 'pago'::public.payment_status,
           updated_at = now()
     WHERE id = v_inv.payment_id
       AND status <> 'pago'::public.payment_status;

    INSERT INTO public.payment_observations
      (hospital_id, payment_id, author_type, author_id, message, observation_type, status_to)
    VALUES (
      v_inv.hospital_id, v_inv.payment_id, 'sistema'::public.observation_author, v_uid,
      'Pagamento liquidado no sistema financeiro',
      'informativo'::public.observation_type,
      'pago'::public.payment_status
    );
  END IF;

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_invoice_paga(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_paga(uuid) TO authenticated;
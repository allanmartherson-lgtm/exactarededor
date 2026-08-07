-- 1) Versionamento de arquivos de NF ------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_file_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  payment_id uuid,
  hospital_id uuid NOT NULL,
  version integer NOT NULL,
  file_path text,
  invoice_number text,
  received_amount numeric,
  ai_validation jsonb,
  ai_extracted_amount numeric,
  ai_extracted_number text,
  ai_extracted_cnpj text,
  reason text,
  source text NOT NULL CHECK (source IN ('reenvio_empresa','correcao_solicitada')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, version)
);

GRANT SELECT ON public.invoice_file_versions TO authenticated;
GRANT ALL ON public.invoice_file_versions TO service_role;

ALTER TABLE public.invoice_file_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internal staff read invoice file versions"
  ON public.invoice_file_versions FOR SELECT TO authenticated
  USING (public.is_internal_staff(auth.uid())
         AND public.can_access_hospital(auth.uid(), hospital_id));

CREATE INDEX IF NOT EXISTS idx_invoice_file_versions_invoice
  ON public.invoice_file_versions (invoice_id, version DESC);

-- 2) Justificativa de conciliação manual --------------------------------
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS manual_conciliation_note text,
  ADD COLUMN IF NOT EXISTS manual_conciliated_by uuid,
  ADD COLUMN IF NOT EXISTS manual_conciliated_at timestamptz;

-- 3) Correção das RPCs da etapa 1 (can_access_hospital tem 2 args) ------
CREATE OR REPLACE FUNCTION public.mark_invoice_lancada(
  p_invoice_id uuid,
  p_erp_document_number text
)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  IF NOT public.can_access_hospital(v_uid, v_inv.hospital_id) THEN
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
       SET status = 'lancado'::public.payment_status, updated_at = now()
     WHERE id = v_inv.company_group_id
       AND status <> 'lancado'::public.payment_status;
  END IF;

  SELECT COALESCE(full_name, email, v_uid::text) INTO v_actor
    FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.payment_observations
    (hospital_id, payment_id, author_type, author_id, message, observation_type)
  VALUES (v_inv.hospital_id, v_inv.payment_id, 'sistema'::public.observation_author, v_uid,
    format('NF #%s lançada no P12 (doc %s) por %s',
           COALESCE(v_inv.invoice_number, '—'), v_doc, COALESCE(v_actor, 'usuário')),
    'informativo'::public.observation_type);

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_invoice_paga(p_invoice_id uuid)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  IF NOT public.can_access_hospital(v_uid, v_inv.hospital_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'lancada'::public.invoice_status THEN
    RAISE EXCEPTION 'Somente notas lançadas no P12 podem ser marcadas como pagas (status atual: %).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
     SET status = 'paga'::public.invoice_status, paid_at = now(), paid_by = v_uid, updated_at = now()
   WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  SELECT count(*) INTO v_pending FROM public.invoices i
   WHERE i.payment_id = v_inv.payment_id
     AND i.status <> 'cancelada'::public.invoice_status
     AND i.status <> 'paga'::public.invoice_status;

  IF v_pending = 0 THEN
    UPDATE public.payments SET status = 'pago'::public.payment_status, updated_at = now()
     WHERE id = v_inv.payment_id AND status <> 'pago'::public.payment_status;

    INSERT INTO public.payment_observations
      (hospital_id, payment_id, author_type, author_id, message, observation_type, status_to)
    VALUES (v_inv.hospital_id, v_inv.payment_id, 'sistema'::public.observation_author, v_uid,
      'Pagamento liquidado no sistema financeiro',
      'informativo'::public.observation_type, 'pago'::public.payment_status);
  END IF;

  RETURN v_inv;
END;
$$;

-- 4) Novas ações --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_invoice_conciliada_manual(
  p_invoice_id uuid,
  p_justificativa text
)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.invoices;
  v_just text := btrim(COALESCE(p_justificativa, ''));
  v_actor text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'analista'::public.app_role)
          OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Ação restrita a analista ou administrador.' USING ERRCODE = '42501';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access_hospital(v_uid, v_inv.hospital_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status NOT IN ('divergente'::public.invoice_status, 'recebida'::public.invoice_status) THEN
    RAISE EXCEPTION 'Somente notas divergentes ou recebidas podem ser conciliadas manualmente (status atual: %).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
     SET status = 'conciliada'::public.invoice_status,
         manual_conciliation_note = v_just,
         manual_conciliated_by = v_uid,
         manual_conciliated_at = now(),
         updated_at = now()
   WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  SELECT COALESCE(full_name, email, v_uid::text) INTO v_actor FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.payment_observations
    (hospital_id, payment_id, author_type, author_id, message, observation_type)
  VALUES (v_inv.hospital_id, v_inv.payment_id, 'sistema'::public.observation_author, v_uid,
    format('NF #%s conciliada manualmente por %s: %s',
           COALESCE(v_inv.invoice_number, '—'), COALESCE(v_actor, 'usuário'), v_just),
    'justificativa_override'::public.observation_type);

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_invoice_lancamento(
  p_invoice_id uuid,
  p_justificativa text
)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.invoices;
  v_just text := btrim(COALESCE(p_justificativa, ''));
  v_doc text;
  v_actor text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'analista'::public.app_role)
          OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Ação restrita a analista ou administrador.' USING ERRCODE = '42501';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access_hospital(v_uid, v_inv.hospital_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'lancada'::public.invoice_status THEN
    RAISE EXCEPTION 'Somente notas lançadas podem ser estornadas (status atual: %).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  v_doc := v_inv.erp_document_number;

  UPDATE public.invoices
     SET status = 'conciliada'::public.invoice_status,
         erp_document_number = NULL,
         erp_posted_at = NULL,
         erp_posted_by = NULL,
         updated_at = now()
   WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  SELECT COALESCE(full_name, email, v_uid::text) INTO v_actor FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.payment_observations
    (hospital_id, payment_id, author_type, author_id, message, observation_type)
  VALUES (v_inv.hospital_id, v_inv.payment_id, 'sistema'::public.observation_author, v_uid,
    format('Estorno de lançamento: NF #%s (doc %s) voltou para conciliada por %s. Justificativa: %s',
           COALESCE(v_inv.invoice_number, '—'), COALESCE(v_doc, '—'), COALESCE(v_actor, 'usuário'), v_just),
    'justificativa_override'::public.observation_type);

  RETURN v_inv;
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_invoice_paga(
  p_invoice_id uuid,
  p_justificativa text
)
RETURNS public.invoices
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.invoices;
  v_just text := btrim(COALESCE(p_justificativa, ''));
  v_actor text;
  v_new_status public.payment_status;
  v_has_diverg boolean;
  v_has_lancada boolean;
  v_all_conc boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Estorno de pagamento é restrito a administrador.' USING ERRCODE = '42501';
  END IF;
  IF v_just = '' THEN
    RAISE EXCEPTION 'Justificativa é obrigatória.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota fiscal não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_access_hospital(v_uid, v_inv.hospital_id) THEN
    RAISE EXCEPTION 'Sem acesso a esta unidade.' USING ERRCODE = '42501';
  END IF;
  IF v_inv.status <> 'paga'::public.invoice_status THEN
    RAISE EXCEPTION 'Somente notas pagas podem ter o pagamento estornado (status atual: %).', v_inv.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.invoices
     SET status = 'lancada'::public.invoice_status,
         paid_at = NULL, paid_by = NULL, updated_at = now()
   WHERE id = p_invoice_id
  RETURNING * INTO v_inv;

  -- Recalcula o status agregado do lote quando ele estava 'pago'.
  IF EXISTS (SELECT 1 FROM public.payments WHERE id = v_inv.payment_id
              AND status = 'pago'::public.payment_status) THEN
    SELECT
      bool_or(i.status = 'divergente'::public.invoice_status),
      bool_or(i.status IN ('lancada'::public.invoice_status, 'paga'::public.invoice_status)),
      bool_and(i.status IN ('conciliada'::public.invoice_status,
                            'lancada'::public.invoice_status,
                            'paga'::public.invoice_status))
      INTO v_has_diverg, v_has_lancada, v_all_conc
      FROM public.invoices i
     WHERE i.payment_id = v_inv.payment_id
       AND i.status <> 'cancelada'::public.invoice_status;

    v_new_status := CASE
      WHEN COALESCE(v_has_diverg, false) THEN 'nf_divergente'::public.payment_status
      WHEN COALESCE(v_has_lancada, false) THEN 'lancado'::public.payment_status
      WHEN COALESCE(v_all_conc, false) THEN 'nf_conciliada'::public.payment_status
      ELSE 'nf_recebida'::public.payment_status
    END;

    UPDATE public.payments SET status = v_new_status, updated_at = now()
     WHERE id = v_inv.payment_id;
  END IF;

  SELECT COALESCE(full_name, email, v_uid::text) INTO v_actor FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.payment_observations
    (hospital_id, payment_id, author_type, author_id, message, observation_type)
  VALUES (v_inv.hospital_id, v_inv.payment_id, 'sistema'::public.observation_author, v_uid,
    format('Estorno de pagamento: NF #%s voltou para lançada por %s. Justificativa: %s',
           COALESCE(v_inv.invoice_number, '—'), COALESCE(v_actor, 'usuário'), v_just),
    'justificativa_override'::public.observation_type);

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_invoice_conciliada_manual(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revert_invoice_lancamento(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revert_invoice_paga(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_conciliada_manual(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_invoice_lancamento(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_invoice_paga(uuid, text) TO authenticated;
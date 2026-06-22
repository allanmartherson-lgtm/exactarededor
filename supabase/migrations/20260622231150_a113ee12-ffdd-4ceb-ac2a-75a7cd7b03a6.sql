CREATE OR REPLACE FUNCTION public.sync_payment_company_group(
  p_payment_id uuid,
  p_company_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_total numeric;
  v_name text;
  v_hospital_id uuid;
  v_mode public.payment_analysis_mode;
  v_updated int;
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT hospital_id, analysis_mode
    INTO v_hospital_id, v_mode
    FROM public.payments
   WHERE id = p_payment_id;

  -- Defesa contra dados antigos órfãos: se o pagamento pai não existe mais,
  -- não tente criar/atualizar payment_company_groups, pois isso estoura FK
  -- e pode bloquear operações indiretas como salvar regra (via ON DELETE SET NULL
  -- em payment_items.applied_calc_id).
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)::int, coalesce(sum(gross_amount), 0), max(company_name)
    INTO v_count, v_total, v_name
    FROM public.payment_items
   WHERE payment_id = p_payment_id AND company_id = p_company_id;

  IF v_hospital_id IS NULL THEN
    SELECT hospital_id INTO v_hospital_id
      FROM public.payment_items
     WHERE payment_id = p_payment_id AND hospital_id IS NOT NULL
     LIMIT 1;
  END IF;

  IF v_count = 0 THEN
    UPDATE public.payment_company_groups
       SET items_count = 0,
           total_amount = 0,
           bruto_total = 0,
           confeccao_status = CASE WHEN v_mode = 'confeccao' THEN confeccao_status ELSE NULL END,
           updated_at = now()
     WHERE payment_id = p_payment_id AND company_id = p_company_id;
    RETURN;
  END IF;

  UPDATE public.payment_company_groups
     SET items_count = v_count,
         total_amount = v_total,
         bruto_total = v_total,
         company_name = COALESCE(company_name, v_name),
         confeccao_status = CASE
           WHEN v_mode = 'confeccao' THEN confeccao_status
           ELSE NULL
         END,
         updated_at = now()
   WHERE payment_id = p_payment_id AND company_id = p_company_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated > 0 THEN RETURN; END IF;

  IF v_hospital_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.payment_company_groups (
    payment_id, hospital_id, company_id, company_name,
    items_count, total_amount, bruto_total, status,
    confeccao_status
  )
  VALUES (
    p_payment_id, v_hospital_id, p_company_id, coalesce(v_name, '—'),
    v_count, v_total, v_total, 'revisao_analista',
    CASE WHEN v_mode = 'confeccao' THEN 'em_confeccao'::public.confeccao_status ELSE NULL END
  );
END;
$$;
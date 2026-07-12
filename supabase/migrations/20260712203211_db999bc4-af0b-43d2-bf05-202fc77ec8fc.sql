
-- 1) Helper: garantir que exista uma linha de snapshot financeiro (PCF) para (payment, company).
--    Antes, o snapshot só era criado quando alguém abria a análise da PJ. Se ninguém abria,
--    as glosas aplicadas via edge não tinham para onde ir e o Panorama mostrava "Apurado glosas = 0".
CREATE OR REPLACE FUNCTION public.ensure_payment_company_financials_row(
  p_payment_id uuid,
  p_company_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_exists boolean;
  v_hospital uuid;
  v_bruto numeric;
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN RETURN; END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.payment_company_financials
     WHERE payment_id = p_payment_id AND company_id = p_company_id
  ) INTO v_exists;
  IF v_exists THEN RETURN; END IF;

  SELECT hospital_id INTO v_hospital FROM public.payments WHERE id = p_payment_id;
  IF v_hospital IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(gross_amount), 0) INTO v_bruto
    FROM public.payment_items
   WHERE payment_id = p_payment_id
     AND company_id = p_company_id
     AND COALESCE(is_cancelled, false) = false
     AND COALESCE(package_absorbed, false) = false;

  INSERT INTO public.payment_company_financials
    (payment_id, company_id, hospital_id, bruto, liquido)
  VALUES
    (p_payment_id, p_company_id, v_hospital, ROUND(v_bruto::numeric, 2), ROUND(v_bruto::numeric, 2))
  ON CONFLICT (payment_id, company_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_payment_company_financials_row(uuid, uuid) TO authenticated, service_role;

-- 2) Reforçar o recompute de glosas: se a linha PCF não existir, criar antes de somar.
CREATE OR REPLACE FUNCTION public.recompute_company_glosas_snapshot(
  p_payment_id uuid, p_company_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_glosas numeric;
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN RETURN; END IF;

  PERFORM public.ensure_payment_company_financials_row(p_payment_id, p_company_id);

  SELECT COALESCE(SUM(valor_aplicado), 0)
    INTO v_glosas
    FROM public.glosa_payment_applications
   WHERE payment_id = p_payment_id
     AND company_id = p_company_id
     AND status NOT IN ('revertido', 'pending_manual_resolution');

  UPDATE public.payment_company_financials
     SET glosas = ROUND(v_glosas::numeric, 2),
         liquido = ROUND((bruto - debitos + creditos - v_glosas - pool + conciliacao)::numeric, 2),
         updated_at = now()
   WHERE payment_id = p_payment_id
     AND company_id = p_company_id;
END;
$$;

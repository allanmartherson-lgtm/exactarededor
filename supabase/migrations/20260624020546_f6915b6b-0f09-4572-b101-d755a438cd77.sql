
CREATE OR REPLACE FUNCTION public.test_group_reconciliation_gate()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_hospital_id uuid;
  v_user_id uuid;
  v_payment_historico uuid := gen_random_uuid();
  v_payment_normal    uuid := gen_random_uuid();
  v_group_historico   uuid := gen_random_uuid();
  v_group_normal      uuid := gen_random_uuid();
  v_ref text := 'REGRESSION-GATE-' || extract(epoch from now())::text;
  v_competencia date := DATE '2026-03-01';
  v_caught_normal boolean := false;
  v_caught_historico boolean := false;
  v_err text;
  v_bt numeric; v_bp numeric;
BEGIN
  SELECT id INTO v_hospital_id FROM public.hospitals LIMIT 1;
  SELECT created_by INTO v_user_id FROM public.payments WHERE created_by IS NOT NULL LIMIT 1;
  IF v_user_id IS NULL THEN v_user_id := gen_random_uuid(); END IF;

  INSERT INTO public.payments(id, reference, created_by, hospital_id, import_mode, status, competence_month)
    VALUES (v_payment_historico, v_ref || '-H', v_user_id, v_hospital_id, 'historico', 'em_analise_ia', v_competencia),
           (v_payment_normal,    v_ref || '-N', v_user_id, v_hospital_id, 'normal',    'em_analise_ia', v_competencia);

  INSERT INTO public.payment_company_groups(id, payment_id, hospital_id, company_name, status)
    VALUES (v_group_historico, v_payment_historico, v_hospital_id, 'TEST HISTORICO', 'revisao_analista'),
           (v_group_normal,    v_payment_normal,    v_hospital_id, 'TEST NORMAL',    'revisao_analista');

  -- Forçar bruto_total via UPDATE (alguma trigger BEFORE INSERT reseta para 0)
  UPDATE public.payment_company_groups SET bruto_total = 100000
    WHERE id IN (v_group_historico, v_group_normal);

  SELECT bruto_total INTO v_bt FROM public.payment_company_groups WHERE id = v_group_normal;
  SELECT bruto_pedido_total INTO v_bp FROM public.vw_group_rule_totals WHERE group_id = v_group_normal;
  RETURN QUERY SELECT 'debug_setup'::text, true,
    format('group.bruto_total=%s view.bruto_pedido=%s', v_bt, v_bp);

  BEGIN
    UPDATE public.payment_company_groups SET status = 'pago' WHERE id = v_group_historico;
  EXCEPTION WHEN OTHERS THEN
    v_caught_historico := true;
    v_err := SQLERRM;
  END;

  IF v_caught_historico THEN
    RETURN QUERY SELECT 'historico_skips_gate'::text, false,
      ('trigger bloqueou indevidamente lote histórico: ' || COALESCE(v_err,''))::text;
  ELSE
    RETURN QUERY SELECT 'historico_skips_gate'::text, true,
      'transição revisao_analista→pago permitida em modo histórico mesmo com divergência'::text;
  END IF;

  BEGIN
    UPDATE public.payment_company_groups SET status = 'pago' WHERE id = v_group_normal;
  EXCEPTION WHEN OTHERS THEN
    v_caught_normal := true;
    v_err := SQLERRM;
  END;

  IF v_caught_normal THEN
    RETURN QUERY SELECT 'normal_blocks_on_divergence'::text, true,
      ('trigger bloqueou como esperado: ' || left(v_err, 160))::text;
  ELSE
    RETURN QUERY SELECT 'normal_blocks_on_divergence'::text, false,
      'trigger NÃO bloqueou divergência grande em modo normal'::text;
  END IF;

  DELETE FROM public.payment_company_groups WHERE id IN (v_group_historico, v_group_normal);
  DELETE FROM public.payments WHERE id IN (v_payment_historico, v_payment_normal);
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.payment_company_groups WHERE id IN (v_group_historico, v_group_normal);
  DELETE FROM public.payments WHERE id IN (v_payment_historico, v_payment_normal);
  RAISE;
END;
$$;

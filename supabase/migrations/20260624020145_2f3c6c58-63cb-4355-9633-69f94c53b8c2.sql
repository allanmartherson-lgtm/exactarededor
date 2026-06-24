
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
BEGIN
  SELECT id INTO v_hospital_id FROM public.hospitals LIMIT 1;
  IF v_hospital_id IS NULL THEN
    RETURN QUERY SELECT 'setup'::text, false, 'no hospital available'::text;
    RETURN;
  END IF;

  SELECT id INTO v_user_id FROM auth.users LIMIT 1;
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
  END IF;

  INSERT INTO public.payments(id, reference, created_by, hospital_id, import_mode, status, competencia)
    VALUES (v_payment_historico, v_ref || '-H', v_user_id, v_hospital_id, 'historico', 'em_analise_ia', v_competencia),
           (v_payment_normal,    v_ref || '-N', v_user_id, v_hospital_id, 'normal',    'em_analise_ia', v_competencia);

  INSERT INTO public.payment_company_groups(id, payment_id, hospital_id, company_name, status)
    VALUES (v_group_historico, v_payment_historico, v_hospital_id, 'TEST HISTORICO', 'revisao_analista'),
           (v_group_normal,    v_payment_normal,    v_hospital_id, 'TEST NORMAL',    'revisao_analista');

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
      'transição revisao_analista→pago permitida em modo histórico'::text;
  END IF;

  INSERT INTO public.payment_items(id, payment_id, payment_company_group_id, hospital_id,
    procedure_amount, gross_amount, doctor_name)
  VALUES (gen_random_uuid(), v_payment_normal, v_group_normal, v_hospital_id,
    100000, 100000, 'TEST DOCTOR REGRESSION');

  BEGIN
    UPDATE public.payment_company_groups SET status = 'pago' WHERE id = v_group_normal;
  EXCEPTION WHEN OTHERS THEN
    v_caught_normal := true;
    v_err := SQLERRM;
  END;

  IF v_caught_normal THEN
    RETURN QUERY SELECT 'normal_blocks_on_divergence'::text, true,
      ('trigger bloqueou como esperado: ' || left(v_err, 120))::text;
  ELSE
    RETURN QUERY SELECT 'normal_blocks_on_divergence'::text, false,
      'trigger NÃO bloqueou divergência grande em modo normal'::text;
  END IF;

  DELETE FROM public.payment_items WHERE payment_id IN (v_payment_historico, v_payment_normal);
  DELETE FROM public.payment_company_groups WHERE id IN (v_group_historico, v_group_normal);
  DELETE FROM public.payments WHERE id IN (v_payment_historico, v_payment_normal);
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.payment_items WHERE payment_id IN (v_payment_historico, v_payment_normal);
  DELETE FROM public.payment_company_groups WHERE id IN (v_group_historico, v_group_normal);
  DELETE FROM public.payments WHERE id IN (v_payment_historico, v_payment_normal);
  RAISE;
END;
$$;

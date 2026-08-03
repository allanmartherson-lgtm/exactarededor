DO $$
DECLARE
  v_payment uuid := 'bae5bfc1-85df-460a-9279-d38470cf38c5';
  v_from uuid;
  v_to uuid;
  v_cleared int;
BEGIN
  SELECT id INTO v_to FROM public.hospitals WHERE slug = 'santa_luzia';
  SELECT hospital_id INTO v_from FROM public.payments WHERE id = v_payment;
  IF v_to IS NULL OR v_from IS NULL THEN
    RAISE EXCEPTION 'hospital origem/destino não resolvido';
  END IF;
  IF v_from = v_to THEN
    RAISE NOTICE 'lote já está no destino; nada a fazer';
    RETURN;
  END IF;

  -- Desliga triggers de escopo/derivação: esta é uma correção administrativa
  -- controlada, e os triggers de hospital_id herdado do pai impediriam o update.
  SET LOCAL session_replication_role = replica;

  UPDATE public.payments SET hospital_id = v_to WHERE id = v_payment;

  UPDATE public.payment_items            SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.payment_company_groups   SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.payment_company_financials SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.payment_observations     SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.payment_status_history   SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.payment_processing_jobs  SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.payment_job_context      SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.ai_analysis_versions     SET hospital_id = v_to WHERE payment_id = v_payment;
  UPDATE public.analysis_telemetry       SET hospital_id = v_to WHERE payment_id = v_payment;

  -- Regras são hospital-scoped: cálculo herdado do DF Star não vale no Santa Luzia.
  UPDATE public.payment_items
     SET applied_rule_id = NULL,
         applied_calc_id = NULL
   WHERE payment_id = v_payment
     AND applied_rule_id IS NOT NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  SET LOCAL session_replication_role = origin;

  INSERT INTO public.audit_log (entity_type, entity_id, action, diff, hospital_id)
  VALUES (
    'payments',
    v_payment,
    'hospital_reassign',
    jsonb_build_object(
      'from_hospital_id', v_from,
      'to_hospital_id', v_to,
      'reason', 'lote HSL importado com DF Star como unidade ativa (erro de imputação)',
      'rule_links_cleared', v_cleared
    ),
    v_to
  );
END $$;
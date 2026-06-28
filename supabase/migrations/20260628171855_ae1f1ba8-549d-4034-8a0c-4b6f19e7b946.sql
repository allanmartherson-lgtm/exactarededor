CREATE OR REPLACE FUNCTION public.init_engine_sources_for_payment(_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _has_pool boolean;
  _has_companies boolean;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.payments WHERE id = _payment_id AND pool_id IS NOT NULL)
    INTO _has_pool;
  SELECT EXISTS(SELECT 1 FROM public.payment_company_groups WHERE payment_id = _payment_id AND company_id IS NOT NULL)
    INTO _has_companies;

  PERFORM public.declare_engine_source_applicable(_payment_id, 'rules', true);
  PERFORM public.declare_engine_source_applicable(_payment_id, 'payout_model', true);
  PERFORM public.declare_engine_source_applicable(_payment_id, 'minimum_guarantee', true);

  IF _has_companies THEN
    PERFORM public.declare_engine_source_applicable(_payment_id, 'company_adjustments', true);
    PERFORM public.declare_engine_source_applicable(_payment_id, 'glosa_debts', true);
  ELSE
    PERFORM public.declare_engine_source_applicable(_payment_id, 'company_adjustments', false);
    PERFORM public.declare_engine_source_applicable(_payment_id, 'glosa_debts', false);
  END IF;

  IF _has_pool THEN
    PERFORM public.declare_engine_source_applicable(_payment_id, 'pool_deductions', true);
  ELSE
    PERFORM public.declare_engine_source_applicable(_payment_id, 'pool_deductions', false);
  END IF;

  PERFORM public.declare_engine_source_applicable(
    _payment_id, 'retroactive_reconciliation',
    EXISTS(SELECT 1 FROM public.retroactive_reconciliation_items WHERE payment_id = _payment_id)
  );
  PERFORM public.declare_engine_source_applicable(
    _payment_id, 'special_case_marks',
    EXISTS(SELECT 1 FROM public.special_case_marks WHERE payment_id = _payment_id AND status = 'approved')
  );
END;
$function$;
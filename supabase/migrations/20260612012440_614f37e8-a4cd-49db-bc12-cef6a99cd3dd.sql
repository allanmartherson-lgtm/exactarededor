CREATE OR REPLACE FUNCTION public.clone_rule_to_hospital(_rule_id uuid, _target_hospital_id uuid, _new_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_src public.rules%ROWTYPE;
  v_new_id uuid := gen_random_uuid();
  v_name text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (public.has_role(v_actor, 'admin'::app_role) OR public.has_role(v_actor, 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para clonar regras' USING ERRCODE = '42501';
  END IF;
  IF _target_hospital_id IS NULL THEN
    RAISE EXCEPTION 'Hospital de destino é obrigatório' USING ERRCODE = '23502';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hospitals WHERE id = _target_hospital_id) THEN
    RAISE EXCEPTION 'Hospital de destino não encontrado' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_src FROM public.rules WHERE id = _rule_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Regra origem % não encontrada', _rule_id USING ERRCODE = '02000';
  END IF;
  IF v_src.hospital_id = _target_hospital_id THEN
    RAISE EXCEPTION 'Regra já pertence a este hospital' USING ERRCODE = '23514';
  END IF;

  v_name := COALESCE(NULLIF(trim(_new_name), ''), v_src.name);

  INSERT INTO public.rules (
    id, name, description, rule_text, severity, active, created_by, scope,
    target_type, target_identifier, target_name, package_amount, bonus_amount,
    bonus_pct, target_amount, reference_table_id, multiplier, deflator_pct,
    include_auxiliaries, auxiliary_pct, valid_from, valid_until, time_mode,
    weekdays, includes_holidays, time_start, time_end, elective_mode,
    target_company_id, calculation_type, convenio_percentage, fixed_amount,
    extras_codes, repasse_pct, apply_access_route, package_main_code,
    package_included_codes, package_visits_count, package_opinions_count,
    package_auxiliaries_included, package_subtype, exclusion_reason,
    allows_authorized_exception, aux_first_pct, aux_second_pct,
    instrumentador_pct, group_company_links, agreement_name,
    agreement_match_mode, exception_table_ids, limiar_alerta_tipo,
    limiar_alerta_valor, limiar_bloqueio_tipo, limiar_bloqueio_valor,
    has_conditions, force_totalized, group_doctors, target_doctor_id,
    hospital_id, minimo_garantido_ativo, minimo_garantido_valor,
    minimo_garantido_escopo, minimo_garantido_periodicidade, minimo_garantido_base
  ) VALUES (
    v_new_id, v_name, v_src.description, v_src.rule_text, v_src.severity, v_src.active,
    v_actor, v_src.scope, v_src.target_type, v_src.target_identifier, v_src.target_name,
    v_src.package_amount, v_src.bonus_amount, v_src.bonus_pct, v_src.target_amount,
    v_src.reference_table_id, v_src.multiplier, v_src.deflator_pct, v_src.include_auxiliaries,
    v_src.auxiliary_pct, v_src.valid_from, v_src.valid_until, v_src.time_mode, v_src.weekdays,
    v_src.includes_holidays, v_src.time_start, v_src.time_end, v_src.elective_mode,
    v_src.target_company_id, v_src.calculation_type, v_src.convenio_percentage,
    v_src.fixed_amount, v_src.extras_codes, v_src.repasse_pct, v_src.apply_access_route,
    v_src.package_main_code, v_src.package_included_codes, v_src.package_visits_count,
    v_src.package_opinions_count, v_src.package_auxiliaries_included,
    v_src.package_subtype, v_src.exclusion_reason, v_src.allows_authorized_exception,
    v_src.aux_first_pct, v_src.aux_second_pct, v_src.instrumentador_pct,
    v_src.group_company_links, v_src.agreement_name, v_src.agreement_match_mode,
    v_src.exception_table_ids, v_src.limiar_alerta_tipo, v_src.limiar_alerta_valor,
    v_src.limiar_bloqueio_tipo, v_src.limiar_bloqueio_valor, v_src.has_conditions,
    v_src.force_totalized, v_src.group_doctors, v_src.target_doctor_id,
    _target_hospital_id,
    v_src.minimo_garantido_ativo, v_src.minimo_garantido_valor,
    v_src.minimo_garantido_escopo, v_src.minimo_garantido_periodicidade, v_src.minimo_garantido_base
  );

  -- Clona TODOS os rule_calculations da regra origem para a nova regra,
  -- usando exatamente os nomes de colunas atuais do schema. Preenche
  -- hospital_id com o destino para manter o isolamento multi-tenant.
  INSERT INTO public.rule_calculations (
    rule_id, hospital_id, sort_order, label, calculation_type,
    fixed_amount, target_amount, multiplier, deflator_pct,
    bonus_amount, bonus_pct, reference_table_id, repasse_pct, acrescimo_pct,
    convenio_percentage, auxiliary_pct, aux_first_pct, aux_second_pct,
    instrumentador_pct, include_auxiliaries, package_amount, package_subtype,
    package_main_code, package_included_codes, package_auxiliaries_included,
    package_opinions_count, package_visits_count, package_roles_distribution,
    extras_codes, apply_access_route, allowed_access_routes,
    time_mode, weekdays, time_start, time_end, includes_holidays, elective_mode,
    has_conditions, context_conditions, sectors, specialties,
    force_totalized, application_unit, procedure_codes, procedure_keywords,
    code_match_mode, doctor_roles, agreement_match_mode, agreement_aliases
  )
  SELECT
    v_new_id, _target_hospital_id, sort_order, label, calculation_type,
    fixed_amount, target_amount, multiplier, deflator_pct,
    bonus_amount, bonus_pct, reference_table_id, repasse_pct, acrescimo_pct,
    convenio_percentage, auxiliary_pct, aux_first_pct, aux_second_pct,
    instrumentador_pct, include_auxiliaries, package_amount, package_subtype,
    package_main_code, package_included_codes, package_auxiliaries_included,
    package_opinions_count, package_visits_count, package_roles_distribution,
    extras_codes, apply_access_route, allowed_access_routes,
    time_mode, weekdays, time_start, time_end, includes_holidays, elective_mode,
    has_conditions, context_conditions, sectors, specialties,
    force_totalized, application_unit, procedure_codes, procedure_keywords,
    code_match_mode, doctor_roles, agreement_match_mode, agreement_aliases
  FROM public.rule_calculations
  WHERE rule_id = _rule_id;

  RETURN v_new_id;
END;
$function$;
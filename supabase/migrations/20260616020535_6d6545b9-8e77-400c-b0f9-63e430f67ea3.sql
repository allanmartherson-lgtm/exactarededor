CREATE OR REPLACE FUNCTION public.apply_rule_save_with_corrections(
  _rule_data     jsonb,
  _calculations  jsonb,
  _corrections   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_rule_id uuid;
  v_is_update boolean := false;
  v_corr jsonb;
  v_corr_rule_id uuid;
  v_corr_new_until date;
  v_old_until date;
  v_corr_hospital_id uuid;
  v_calcs_inserted int := 0;
  v_corrections_applied int := 0;
  v_hospital_id uuid;
  v_active_hospital uuid := public.current_active_hospital();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  IF NOT (public.has_role(v_actor, 'admin'::app_role) OR public.has_role(v_actor, 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'Apenas admin ou diretor podem salvar regras' USING ERRCODE = '42501';
  END IF;

  IF _rule_data IS NULL OR jsonb_typeof(_rule_data) <> 'object' THEN
    RAISE EXCEPTION '_rule_data inválido' USING ERRCODE = '22023';
  END IF;

  IF _calculations IS NULL OR jsonb_typeof(_calculations) <> 'array' THEN
    RAISE EXCEPTION '_calculations precisa ser array' USING ERRCODE = '22023';
  END IF;

  IF _corrections IS NULL THEN
    _corrections := '[]'::jsonb;
  END IF;

  v_rule_id := NULLIF(_rule_data->>'id','')::uuid;
  v_is_update := v_rule_id IS NOT NULL;

  IF v_is_update THEN
    SELECT r.hospital_id
      INTO v_hospital_id
      FROM public.rules r
     WHERE r.id = v_rule_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Regra % não encontrada', v_rule_id USING ERRCODE = 'P0002';
    END IF;

    IF NULLIF(_rule_data->>'hospital_id','')::uuid IS NULL THEN
      RAISE EXCEPTION 'hospital_id é obrigatório ao editar uma regra' USING ERRCODE = '23502';
    END IF;

    IF NULLIF(_rule_data->>'hospital_id','')::uuid <> v_hospital_id THEN
      RAISE EXCEPTION 'Unidade enviada não corresponde à unidade vinculada da regra' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_hospital_id := NULLIF(_rule_data->>'hospital_id','')::uuid;

    IF v_hospital_id IS NULL THEN
      RAISE EXCEPTION 'hospital_id é obrigatório ao criar uma regra' USING ERRCODE = '23502';
    END IF;
  END IF;

  IF v_active_hospital IS NOT NULL AND v_active_hospital <> v_hospital_id THEN
    RAISE EXCEPTION 'Unidade ativa divergente da unidade enviada na regra' USING ERRCODE = '42501';
  END IF;

  IF NOT public.hospital_scope_allows(v_hospital_id) THEN
    RAISE EXCEPTION 'Usuário sem acesso à unidade vinculada da regra' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(_corrections) = 'array' THEN
    FOR v_corr IN SELECT * FROM jsonb_array_elements(_corrections) LOOP
      IF (v_corr->>'type') = 'set_valid_until' THEN
        v_corr_rule_id := NULLIF(v_corr->>'rule_id','')::uuid;
        v_corr_new_until := NULLIF(v_corr->>'new_valid_until','')::date;

        IF v_corr_rule_id IS NULL OR v_corr_new_until IS NULL THEN
          RAISE EXCEPTION 'Correção set_valid_until exige rule_id e new_valid_until' USING ERRCODE = '22023';
        END IF;

        SELECT valid_until, hospital_id
          INTO v_old_until, v_corr_hospital_id
          FROM public.rules
         WHERE id = v_corr_rule_id;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Correção: regra % não encontrada', v_corr_rule_id USING ERRCODE = 'P0002';
        END IF;

        IF v_corr_hospital_id <> v_hospital_id THEN
          RAISE EXCEPTION 'Correção pertence a outra unidade' USING ERRCODE = '42501';
        END IF;

        IF NOT public.hospital_scope_allows(v_corr_hospital_id) THEN
          RAISE EXCEPTION 'Usuário sem acesso à unidade da correção' USING ERRCODE = '42501';
        END IF;

        UPDATE public.rules
           SET valid_until = v_corr_new_until,
               updated_at = now()
         WHERE id = v_corr_rule_id
           AND hospital_id = v_hospital_id;

        INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff, hospital_id)
        VALUES (
          v_actor,
          'rule',
          v_corr_rule_id,
          'auto_set_valid_until',
          jsonb_build_object('from', v_old_until, 'to', v_corr_new_until, 'reason', 'rule_save_with_corrections'),
          v_hospital_id
        );

        v_corrections_applied := v_corrections_applied + 1;
      ELSE
        RAISE EXCEPTION 'Tipo de correção desconhecido: %', (v_corr->>'type') USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  IF v_is_update THEN
    UPDATE public.rules r
       SET name = COALESCE((_rule_data->>'name'), r.name),
           description = _rule_data->>'description',
           rule_text = COALESCE((_rule_data->>'rule_text'), r.rule_text),
           scope = COALESCE((_rule_data->>'scope')::public.rule_scope, r.scope),
           target_type = NULLIF(_rule_data->>'target_type','')::public.rule_target_type,
           target_identifier = _rule_data->>'target_identifier',
           target_name = _rule_data->>'target_name',
           target_company_id = NULLIF(_rule_data->>'target_company_id','')::uuid,
           valid_from = NULLIF(_rule_data->>'valid_from','')::date,
           valid_until = NULLIF(_rule_data->>'valid_until','')::date,
           active = COALESCE((_rule_data->>'active')::boolean, r.active),
           severity = COALESCE((_rule_data->>'severity')::public.rule_severity, r.severity),
           group_doctors = COALESCE(_rule_data->'group_doctors', r.group_doctors),
           group_company_links = COALESCE(_rule_data->'group_company_links', r.group_company_links),
           hospital_id = v_hospital_id,
           updated_at = now()
     WHERE r.id = v_rule_id
       AND r.hospital_id = v_hospital_id;

    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff, hospital_id)
    VALUES (v_actor, 'rule', v_rule_id, 'update_via_rpc', _rule_data, v_hospital_id);
  ELSE
    INSERT INTO public.rules (
      name, description, rule_text, scope, target_type, target_identifier, target_name,
      target_company_id, valid_from, valid_until, active, severity,
      group_doctors, group_company_links, created_by, hospital_id
    ) VALUES (
      _rule_data->>'name',
      _rule_data->>'description',
      COALESCE(_rule_data->>'rule_text',''),
      COALESCE((_rule_data->>'scope')::public.rule_scope, 'master'::public.rule_scope),
      NULLIF(_rule_data->>'target_type','')::public.rule_target_type,
      _rule_data->>'target_identifier',
      _rule_data->>'target_name',
      NULLIF(_rule_data->>'target_company_id','')::uuid,
      NULLIF(_rule_data->>'valid_from','')::date,
      NULLIF(_rule_data->>'valid_until','')::date,
      COALESCE((_rule_data->>'active')::boolean, true),
      COALESCE((_rule_data->>'severity')::public.rule_severity, 'aviso'::public.rule_severity),
      COALESCE(_rule_data->'group_doctors', '[]'::jsonb),
      COALESCE(_rule_data->'group_company_links', '[]'::jsonb),
      v_actor,
      v_hospital_id
    )
    RETURNING id INTO v_rule_id;

    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff, hospital_id)
    VALUES (v_actor, 'rule', v_rule_id, 'create_via_rpc', _rule_data, v_hospital_id);
  END IF;

  DELETE FROM public.rule_calculations
   WHERE rule_id = v_rule_id
     AND hospital_id = v_hospital_id;

  IF jsonb_array_length(_calculations) > 0 THEN
    INSERT INTO public.rule_calculations
    SELECT (jsonb_populate_record(
      NULL::public.rule_calculations,
      (c.value - 'id' - 'rule_id' - 'hospital_id' - 'created_at' - 'updated_at')
        || jsonb_build_object(
             'id', gen_random_uuid(),
             'rule_id', v_rule_id,
             'hospital_id', v_hospital_id,
             'created_at', to_jsonb(now()),
             'updated_at', to_jsonb(now())
           )
    )).*
    FROM jsonb_array_elements(_calculations) AS c(value);

    GET DIAGNOSTICS v_calcs_inserted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rule_id', v_rule_id,
    'is_update', v_is_update,
    'hospital_id', v_hospital_id,
    'calculations_inserted', v_calcs_inserted,
    'corrections_applied', v_corrections_applied
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_rule_save_with_corrections(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_rule_save_with_corrections(jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_rule_save_with_corrections(jsonb, jsonb, jsonb) TO service_role;
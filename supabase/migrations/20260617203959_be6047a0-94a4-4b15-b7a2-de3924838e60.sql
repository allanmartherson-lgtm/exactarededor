CREATE OR REPLACE FUNCTION public.guard_rule_calculation_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.rule_calc_delete_authorized', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'Exclusão direta de cálculo de regra bloqueada. Use o fluxo oficial de salvamento de regra, com confirmação explícita quando houver redução de cálculos.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_rule_calculation_delete ON public.rule_calculations;
CREATE TRIGGER trg_guard_rule_calculation_delete
BEFORE DELETE ON public.rule_calculations
FOR EACH ROW
EXECUTE FUNCTION public.guard_rule_calculation_delete();

CREATE OR REPLACE FUNCTION public.apply_rule_save_with_corrections(_rule_data jsonb, _calculations jsonb, _corrections jsonb, _allow_calc_reduction boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_prev_calc_count int := 0;
  v_incoming_calc_count int := 0;
  v_before_snapshot_id uuid;
  v_after_snapshot_id uuid;
  v_removed_calcs jsonb := '[]'::jsonb;
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

  v_incoming_calc_count := jsonb_array_length(_calculations);
  v_rule_id := NULLIF(_rule_data->>'id','')::uuid;
  v_is_update := v_rule_id IS NOT NULL;

  IF v_is_update THEN
    SELECT r.hospital_id INTO v_hospital_id
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

    SELECT count(*) INTO v_prev_calc_count
      FROM public.rule_calculations
     WHERE rule_id = v_rule_id;

    SELECT COALESCE(jsonb_agg(to_jsonb(rc) ORDER BY rc.sort_order, rc.id), '[]'::jsonb)
      INTO v_removed_calcs
      FROM public.rule_calculations rc
     WHERE rc.rule_id = v_rule_id;

    INSERT INTO public.rule_snapshots(rule_id, hospital_id, reason, payload, calc_count, actor_id)
    VALUES (
      v_rule_id, v_hospital_id, 'before_edit',
      public.build_rule_snapshot_payload(v_rule_id),
      v_prev_calc_count, v_actor
    )
    RETURNING id INTO v_before_snapshot_id;

    IF v_prev_calc_count > 0
       AND v_incoming_calc_count < v_prev_calc_count
       AND NOT _allow_calc_reduction THEN
      RAISE EXCEPTION
        'Operação bloqueada: a edição removeria % cálculo(s) (de % para %). Confirme a remoção no frontend para prosseguir.',
        v_prev_calc_count - v_incoming_calc_count, v_prev_calc_count, v_incoming_calc_count
        USING ERRCODE = '23514';
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
          RAISE EXCEPTION 'Correção set_valid_until inválida' USING ERRCODE = '22023';
        END IF;

        SELECT r.valid_until, r.hospital_id INTO v_old_until, v_corr_hospital_id
          FROM public.rules r WHERE r.id = v_corr_rule_id;

        IF v_corr_hospital_id IS NULL THEN
          RAISE EXCEPTION 'Regra alvo da correção % não encontrada', v_corr_rule_id USING ERRCODE = 'P0002';
        END IF;

        IF NOT public.hospital_scope_allows(v_corr_hospital_id) THEN
          RAISE EXCEPTION 'Usuário sem acesso à unidade da correção' USING ERRCODE = '42501';
        END IF;

        UPDATE public.rules
           SET valid_until = v_corr_new_until, updated_at = now()
         WHERE id = v_corr_rule_id AND hospital_id = v_hospital_id;

        INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff, hospital_id)
        VALUES (v_actor, 'rule', v_corr_rule_id, 'auto_set_valid_until',
                jsonb_build_object('from', v_old_until, 'to', v_corr_new_until, 'reason', 'rule_save_with_corrections'),
                v_hospital_id);

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
     WHERE r.id = v_rule_id AND r.hospital_id = v_hospital_id;

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

  IF v_is_update AND v_prev_calc_count > v_incoming_calc_count AND _allow_calc_reduction THEN
    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff, hospital_id)
    VALUES (
      v_actor,
      'rule',
      v_rule_id,
      'calc_reduction_confirmed',
      jsonb_build_object(
        'from_count', v_prev_calc_count,
        'to_count', v_incoming_calc_count,
        'removed_count', v_prev_calc_count - v_incoming_calc_count,
        'previous_calculations', v_removed_calcs,
        'reason', 'confirmed_rule_calculation_reduction'
      ),
      v_hospital_id
    );
  END IF;

  PERFORM set_config('app.rule_calc_delete_authorized', 'on', true);

  DELETE FROM public.rule_calculations
   WHERE rule_id = v_rule_id AND hospital_id = v_hospital_id;

  PERFORM set_config('app.rule_calc_delete_authorized', 'off', true);

  IF v_incoming_calc_count > 0 THEN
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

    IF v_calcs_inserted = 0 THEN
      RAISE EXCEPTION
        'Falha de persistência: % cálculo(s) enviados, 0 inseridos. Operação revertida para evitar perda.',
        v_incoming_calc_count
        USING ERRCODE = 'P0001';
    END IF;

    IF v_calcs_inserted < v_incoming_calc_count THEN
      RAISE EXCEPTION
        'Falha de persistência: % cálculo(s) enviados, apenas % inseridos. Operação revertida.',
        v_incoming_calc_count, v_calcs_inserted
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO public.rule_snapshots(rule_id, hospital_id, reason, payload, calc_count, actor_id)
  VALUES (
    v_rule_id, v_hospital_id, 'after_save',
    public.build_rule_snapshot_payload(v_rule_id),
    v_calcs_inserted, v_actor
  )
  RETURNING id INTO v_after_snapshot_id;

  RETURN jsonb_build_object(
    'ok', true,
    'rule_id', v_rule_id,
    'is_update', v_is_update,
    'hospital_id', v_hospital_id,
    'calculations_inserted', v_calcs_inserted,
    'previous_calculations_count', v_prev_calc_count,
    'corrections_applied', v_corrections_applied,
    'snapshot_before_id', v_before_snapshot_id,
    'snapshot_after_id', v_after_snapshot_id
  );
END;
$function$;
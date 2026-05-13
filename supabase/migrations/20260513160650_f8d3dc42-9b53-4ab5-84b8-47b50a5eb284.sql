-- =====================================================================
-- Sub-Onda 2D — Validação preventiva no cadastro de regras (backend)
-- =====================================================================

-- Índices que ajudam a busca por CRM/CNPJ normalizados.
-- O motor compara via only_digits(target_identifier) com only_digits(item.doctor_document/company.document).
CREATE INDEX IF NOT EXISTS idx_rules_target_identifier_digits
  ON public.rules ((public.only_digits(target_identifier)))
  WHERE target_identifier IS NOT NULL AND active = true;

-- =====================================================================
-- 1) extract_rule_targets — expande grupo e devolve CRMs + chaves de empresa
-- =====================================================================
CREATE OR REPLACE FUNCTION public.extract_rule_targets(
  _scope               public.rule_scope,
  _target_type         public.rule_target_type,
  _target_identifier   text,
  _target_company_id   uuid,
  _group_doctors       jsonb,
  _group_company_links jsonb
)
RETURNS TABLE(doctor_crms text[], company_keys text[])
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_doctors text[] := ARRAY[]::text[];
  v_companies text[] := ARRAY[]::text[];
  v_d_norm text;
  v_c_key text;
  v_link jsonb;
  v_inner jsonb;
BEGIN
  IF _scope = 'master'::public.rule_scope THEN
    -- master não tem target específico
    doctor_crms := v_doctors;
    company_keys := v_companies;
    RETURN NEXT;
    RETURN;
  END IF;

  IF _scope = 'especifica'::public.rule_scope THEN
    IF _target_type = 'medico'::public.rule_target_type THEN
      v_d_norm := public.only_digits(_target_identifier);
      IF coalesce(v_d_norm,'') <> '' THEN
        v_doctors := array_append(v_doctors, v_d_norm);
      END IF;
    ELSIF _target_type = 'empresa'::public.rule_target_type THEN
      IF _target_company_id IS NOT NULL THEN
        v_companies := array_append(v_companies, _target_company_id::text);
      ELSE
        v_c_key := public.only_digits(_target_identifier);
        IF coalesce(v_c_key,'') <> '' THEN
          v_companies := array_append(v_companies, v_c_key);
        END IF;
      END IF;
    END IF;
  ELSIF _scope = 'grupo'::public.rule_scope THEN
    -- group_doctors: [{name, crm}, ...]
    IF jsonb_typeof(_group_doctors) = 'array' THEN
      FOR v_inner IN SELECT * FROM jsonb_array_elements(_group_doctors) LOOP
        v_d_norm := public.only_digits(v_inner->>'crm');
        IF coalesce(v_d_norm,'') <> '' THEN
          v_doctors := array_append(v_doctors, v_d_norm);
        END IF;
      END LOOP;
    END IF;

    -- group_company_links: [{company_id, doctors?:[{name,crm}]}, ...]
    IF jsonb_typeof(_group_company_links) = 'array' THEN
      FOR v_link IN SELECT * FROM jsonb_array_elements(_group_company_links) LOOP
        IF (v_link->>'company_id') IS NOT NULL AND (v_link->>'company_id') <> '' THEN
          v_companies := array_append(v_companies, v_link->>'company_id');
        END IF;
        IF jsonb_typeof(v_link->'doctors') = 'array' THEN
          FOR v_inner IN SELECT * FROM jsonb_array_elements(v_link->'doctors') LOOP
            v_d_norm := public.only_digits(v_inner->>'crm');
            IF coalesce(v_d_norm,'') <> '' THEN
              v_doctors := array_append(v_doctors, v_d_norm);
            END IF;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- dedup mantendo ordem irrelevante
  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::text[]) INTO doctor_crms FROM unnest(v_doctors) x;
  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::text[]) INTO company_keys FROM unnest(v_companies) x;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.extract_rule_targets(public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extract_rule_targets(public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb) TO authenticated;

-- =====================================================================
-- 2) validate_rule_save — detecta conflitos sem efeito colateral
-- =====================================================================
-- Retorna jsonb com:
--   { valid: bool, problems: [
--       { type: 'doctor_already_bound'|'company_already_bound'|'validity_overlap'|'master_already_exists',
--         existing_rule_id: uuid, existing_rule_name: text,
--         existing_valid_from: date, existing_valid_until: date,
--         doctor_crm?: text, company_key?: text,
--         suggested_valid_until?: date }
--     ] }
-- calc_overlap NÃO é checado aqui — fica no helper TS via edge function.
CREATE OR REPLACE FUNCTION public.validate_rule_save(
  _rule_id             uuid,
  _scope               public.rule_scope,
  _target_type         public.rule_target_type,
  _target_identifier   text,
  _target_company_id   uuid,
  _group_doctors       jsonb,
  _group_company_links jsonb,
  _valid_from          date,
  _valid_until         date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_targets record;
  v_problems jsonb := '[]'::jsonb;
  v_today date := CURRENT_DATE;
  v_new_from date := COALESCE(_valid_from, v_today);
  v_new_until date := _valid_until; -- NULL = aberta
  v_crm text;
  v_ckey text;
  v_other record;
  v_suggested date;
  v_overlap boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_actor, 'admin'::app_role) OR public.has_role(v_actor, 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para validar regras' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_targets
  FROM public.extract_rule_targets(_scope, _target_type, _target_identifier, _target_company_id, _group_doctors, _group_company_links);

  -- =================== Verificação A — médico ===================
  IF v_targets.doctor_crms IS NOT NULL THEN
    FOREACH v_crm IN ARRAY v_targets.doctor_crms LOOP
      FOR v_other IN
        SELECT r.id, r.name, r.valid_from, r.valid_until
        FROM public.rules r
        WHERE r.active = true
          AND (r.valid_until IS NULL OR r.valid_until >= v_today)
          AND (_rule_id IS NULL OR r.id <> _rule_id)
          AND (
            (r.scope = 'especifica'::public.rule_scope
             AND r.target_type = 'medico'::public.rule_target_type
             AND public.only_digits(r.target_identifier) = v_crm)
            OR
            (r.scope = 'grupo'::public.rule_scope
             AND v_crm = ANY(
               (SELECT t.doctor_crms FROM public.extract_rule_targets(
                  r.scope, r.target_type, r.target_identifier, r.target_company_id,
                  r.group_doctors, r.group_company_links
               ) t)
             ))
          )
      LOOP
        v_problems := v_problems || jsonb_build_object(
          'type', 'doctor_already_bound',
          'doctor_crm', v_crm,
          'existing_rule_id', v_other.id,
          'existing_rule_name', v_other.name,
          'existing_valid_from', v_other.valid_from,
          'existing_valid_until', v_other.valid_until
        );

        -- Verificação C — sobreposição de vigência (sobre o mesmo conflito)
        v_overlap := (
          (v_other.valid_until IS NULL OR v_other.valid_until >= v_new_from)
          AND
          (v_new_until IS NULL OR v_new_until >= COALESCE(v_other.valid_from, v_today))
        );
        IF v_overlap THEN
          v_suggested := v_new_from - INTERVAL '1 day';
          v_problems := v_problems || jsonb_build_object(
            'type', 'validity_overlap',
            'doctor_crm', v_crm,
            'existing_rule_id', v_other.id,
            'existing_rule_name', v_other.name,
            'existing_valid_from', v_other.valid_from,
            'existing_valid_until', v_other.valid_until,
            'suggested_valid_until', (v_new_from - 1)
          );
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- =================== Verificação B — empresa ===================
  IF v_targets.company_keys IS NOT NULL THEN
    FOREACH v_ckey IN ARRAY v_targets.company_keys LOOP
      FOR v_other IN
        SELECT r.id, r.name, r.valid_from, r.valid_until
        FROM public.rules r
        WHERE r.active = true
          AND (r.valid_until IS NULL OR r.valid_until >= v_today)
          AND (_rule_id IS NULL OR r.id <> _rule_id)
          AND (
            (r.scope = 'especifica'::public.rule_scope
             AND r.target_type = 'empresa'::public.rule_target_type
             AND (
               r.target_company_id::text = v_ckey
               OR public.only_digits(r.target_identifier) = v_ckey
             ))
            OR
            (r.scope = 'grupo'::public.rule_scope
             AND v_ckey = ANY(
               (SELECT t.company_keys FROM public.extract_rule_targets(
                  r.scope, r.target_type, r.target_identifier, r.target_company_id,
                  r.group_doctors, r.group_company_links
               ) t)
             ))
          )
      LOOP
        v_problems := v_problems || jsonb_build_object(
          'type', 'company_already_bound',
          'company_key', v_ckey,
          'existing_rule_id', v_other.id,
          'existing_rule_name', v_other.name,
          'existing_valid_from', v_other.valid_from,
          'existing_valid_until', v_other.valid_until
        );

        v_overlap := (
          (v_other.valid_until IS NULL OR v_other.valid_until >= v_new_from)
          AND
          (v_new_until IS NULL OR v_new_until >= COALESCE(v_other.valid_from, v_today))
        );
        IF v_overlap THEN
          v_problems := v_problems || jsonb_build_object(
            'type', 'validity_overlap',
            'company_key', v_ckey,
            'existing_rule_id', v_other.id,
            'existing_rule_name', v_other.name,
            'existing_valid_from', v_other.valid_from,
            'existing_valid_until', v_other.valid_until,
            'suggested_valid_until', (v_new_from - 1)
          );
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  -- =================== Verificação master_already_exists ===================
  IF _scope = 'master'::public.rule_scope THEN
    FOR v_other IN
      SELECT r.id, r.name, r.valid_from, r.valid_until
      FROM public.rules r
      WHERE r.active = true
        AND r.scope = 'master'::public.rule_scope
        AND (r.valid_until IS NULL OR r.valid_until >= v_today)
        AND (_rule_id IS NULL OR r.id <> _rule_id)
    LOOP
      v_overlap := (
        (v_other.valid_until IS NULL OR v_other.valid_until >= v_new_from)
        AND
        (v_new_until IS NULL OR v_new_until >= COALESCE(v_other.valid_from, v_today))
      );
      IF v_overlap THEN
        v_problems := v_problems || jsonb_build_object(
          'type', 'master_already_exists',
          'existing_rule_id', v_other.id,
          'existing_rule_name', v_other.name,
          'existing_valid_from', v_other.valid_from,
          'existing_valid_until', v_other.valid_until,
          'suggested_valid_until', (v_new_from - 1)
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'valid', (jsonb_array_length(v_problems) = 0),
    'problems', v_problems
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_rule_save(uuid, public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_rule_save(uuid, public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb, date, date) TO authenticated;

-- =====================================================================
-- 3) apply_rule_save_with_corrections — save atômico (regra + cálculos + correções)
-- =====================================================================
-- _rule_data:    jsonb com colunas de public.rules (id opcional p/ update; sem id = insert)
-- _calculations: jsonb array com payloads de public.rule_calculations (sem rule_id; será setado)
-- _corrections:  jsonb array [{type:'set_valid_until', rule_id:uuid, new_valid_until:date}, ...]
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
  v_calc jsonb;
  v_calcs_inserted int := 0;
  v_corrections_applied int := 0;
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

  -- 1) Aplica correções em regras anteriores
  IF jsonb_typeof(_corrections) = 'array' THEN
    FOR v_corr IN SELECT * FROM jsonb_array_elements(_corrections) LOOP
      IF (v_corr->>'type') = 'set_valid_until' THEN
        v_corr_rule_id := NULLIF(v_corr->>'rule_id','')::uuid;
        v_corr_new_until := NULLIF(v_corr->>'new_valid_until','')::date;
        IF v_corr_rule_id IS NULL OR v_corr_new_until IS NULL THEN
          RAISE EXCEPTION 'Correção set_valid_until exige rule_id e new_valid_until' USING ERRCODE = '22023';
        END IF;

        SELECT valid_until INTO v_old_until FROM public.rules WHERE id = v_corr_rule_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Correção: regra % não encontrada', v_corr_rule_id USING ERRCODE = 'P0002';
        END IF;

        UPDATE public.rules
           SET valid_until = v_corr_new_until,
               updated_at = now()
         WHERE id = v_corr_rule_id;

        INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
        VALUES (v_actor, 'rule', v_corr_rule_id, 'auto_set_valid_until',
                jsonb_build_object('from', v_old_until, 'to', v_corr_new_until,
                                   'reason', 'rule_save_with_corrections'));
        v_corrections_applied := v_corrections_applied + 1;
      ELSE
        RAISE EXCEPTION 'Tipo de correção desconhecido: %', (v_corr->>'type') USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  -- 2) Insert ou update da regra
  v_rule_id := NULLIF(_rule_data->>'id','')::uuid;
  v_is_update := v_rule_id IS NOT NULL;

  IF v_is_update THEN
    -- Constrói UPDATE dinâmico via jsonb_populate_record na tabela
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
           updated_at = now()
     WHERE r.id = v_rule_id;

    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
    VALUES (v_actor, 'rule', v_rule_id, 'update_via_rpc', _rule_data);
  ELSE
    INSERT INTO public.rules (
      name, description, rule_text, scope, target_type, target_identifier, target_name,
      target_company_id, valid_from, valid_until, active, severity,
      group_doctors, group_company_links, created_by
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
      v_actor
    )
    RETURNING id INTO v_rule_id;

    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
    VALUES (v_actor, 'rule', v_rule_id, 'create_via_rpc', _rule_data);
  END IF;

  -- 3) Substitui rule_calculations (delete + insert)
  DELETE FROM public.rule_calculations WHERE rule_id = v_rule_id;

  IF jsonb_array_length(_calculations) > 0 THEN
    INSERT INTO public.rule_calculations
    SELECT
      gen_random_uuid() AS id,
      v_rule_id AS rule_id,
      (c.value->>'sort_order')::int AS sort_order,
      c.value->>'calculation_type' AS calculation_type,
      c.value->>'label' AS label,
      now() AS created_at,
      now() AS updated_at,
      -- restante dos campos via jsonb_populate_record
      (jsonb_populate_record(NULL::public.rule_calculations,
        c.value - 'id' - 'rule_id' - 'sort_order' - 'calculation_type' - 'label' - 'created_at' - 'updated_at'
      )).*
    FROM jsonb_array_elements(_calculations) WITH ORDINALITY AS c(value, ord);
    -- nota: o COALESCE acima é simplificado; em caso de campos faltantes, jsonb_populate_record usa NULL.
    GET DIAGNOSTICS v_calcs_inserted = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'rule_id', v_rule_id,
    'is_update', v_is_update,
    'calculations_inserted', v_calcs_inserted,
    'corrections_applied', v_corrections_applied
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_rule_save_with_corrections(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_rule_save_with_corrections(jsonb, jsonb, jsonb) TO authenticated;
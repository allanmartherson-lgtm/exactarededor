
ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS code text;

CREATE OR REPLACE FUNCTION public.next_rule_code(_hospital_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_slug text; v_prefix text; v_seq int;
BEGIN
  SELECT slug INTO v_slug FROM public.hospitals WHERE id = _hospital_id;
  IF v_slug IS NULL THEN RAISE EXCEPTION 'Hospital % não encontrado', _hospital_id; END IF;
  v_prefix := upper(substr(regexp_replace(v_slug, '[^a-zA-Z]', '', 'g'), 1, 3));
  IF length(v_prefix) < 2 THEN v_prefix := upper(substr(v_slug, 1, 3)); END IF;
  SELECT COALESCE(MAX( (regexp_replace(code, '^.*-R0*', ''))::int ), 0) + 1 INTO v_seq
  FROM public.rules WHERE hospital_id = _hospital_id AND code ~ ('^' || v_prefix || '-R[0-9]+$');
  RETURN v_prefix || '-R' || lpad(v_seq::text, 3, '0');
END; $$;

CREATE OR REPLACE FUNCTION public.tg_rules_set_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hospital_id IS NULL THEN
    RAISE EXCEPTION 'rules.hospital_id é obrigatório' USING ERRCODE = '23502';
  END IF;
  IF NEW.code IS NULL OR length(trim(NEW.code)) = 0 THEN
    NEW.code := public.next_rule_code(NEW.hospital_id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rules_set_code ON public.rules;
CREATE TRIGGER trg_rules_set_code BEFORE INSERT ON public.rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_rules_set_code();

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id, hospital_id FROM public.rules WHERE code IS NULL ORDER BY created_at LOOP
    UPDATE public.rules SET code = public.next_rule_code(r.hospital_id) WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.rules ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS rules_hospital_code_uidx ON public.rules(hospital_id, code);

ALTER TABLE public.rules ALTER COLUMN hospital_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rules_hospital_id_fkey' AND conrelid = 'public.rules'::regclass) THEN
    ALTER TABLE public.rules ADD CONSTRAINT rules_hospital_id_fkey
      FOREIGN KEY (hospital_id) REFERENCES public.hospitals(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS rules_hospital_id_idx ON public.rules(hospital_id);

CREATE OR REPLACE FUNCTION public.tg_rules_protect_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'rules.code é imutável (era %, tentou %)', OLD.code, NEW.code USING ERRCODE = '23514';
  END IF;
  IF NEW.hospital_id IS DISTINCT FROM OLD.hospital_id THEN
    RAISE EXCEPTION 'rules.hospital_id é imutável — para mover regra entre hospitais, clone-a' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rules_protect_immutable ON public.rules;
CREATE TRIGGER trg_rules_protect_immutable BEFORE UPDATE ON public.rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_rules_protect_immutable();

CREATE OR REPLACE FUNCTION public.tg_rules_block_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Exclusão de regras não permitida. Use active = false (regra %, code %)', OLD.id, OLD.code USING ERRCODE = '42501';
END; $$;

DROP TRIGGER IF EXISTS trg_rules_block_delete ON public.rules;
CREATE TRIGGER trg_rules_block_delete BEFORE DELETE ON public.rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_rules_block_delete();

-- Clonar regras DF Star → Santa Luzia (rule_calculations está vazio; nada a clonar lá)
DO $$
DECLARE
  v_dfs uuid := '28dffeb5-e0d2-48fb-951b-58419d41e372';
  v_hsl uuid := 'fe55d20f-0d4f-477f-871d-e53866f6b02c';
  r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.rules WHERE hospital_id = v_hsl) THEN
    RAISE NOTICE 'Santa Luzia já possui regras — pulando clonagem'; RETURN;
  END IF;
  FOR r IN SELECT * FROM public.rules WHERE hospital_id = v_dfs ORDER BY created_at LOOP
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
      gen_random_uuid(), r.name, r.description, r.rule_text, r.severity, r.active,
      r.created_by, r.scope, r.target_type, r.target_identifier, r.target_name,
      r.package_amount, r.bonus_amount, r.bonus_pct, r.target_amount,
      r.reference_table_id, r.multiplier, r.deflator_pct, r.include_auxiliaries,
      r.auxiliary_pct, r.valid_from, r.valid_until, r.time_mode, r.weekdays,
      r.includes_holidays, r.time_start, r.time_end, r.elective_mode,
      r.target_company_id, r.calculation_type, r.convenio_percentage,
      r.fixed_amount, r.extras_codes, r.repasse_pct, r.apply_access_route,
      r.package_main_code, r.package_included_codes, r.package_visits_count,
      r.package_opinions_count, r.package_auxiliaries_included,
      r.package_subtype, r.exclusion_reason, r.allows_authorized_exception,
      r.aux_first_pct, r.aux_second_pct, r.instrumentador_pct,
      r.group_company_links, r.agreement_name, r.agreement_match_mode,
      r.exception_table_ids, r.limiar_alerta_tipo, r.limiar_alerta_valor,
      r.limiar_bloqueio_tipo, r.limiar_bloqueio_valor, r.has_conditions,
      r.force_totalized, r.group_doctors, r.target_doctor_id,
      v_hsl,
      r.minimo_garantido_ativo, r.minimo_garantido_valor,
      r.minimo_garantido_escopo, r.minimo_garantido_periodicidade, r.minimo_garantido_base
    );
  END LOOP;
END $$;

-- validate_rule_save com escopo por hospital
DROP FUNCTION IF EXISTS public.validate_rule_save(uuid, public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb, date, date);

CREATE OR REPLACE FUNCTION public.validate_rule_save(
  _rule_id uuid, _scope rule_scope, _target_type rule_target_type,
  _target_identifier text, _target_company_id uuid,
  _group_doctors jsonb, _group_company_links jsonb,
  _valid_from date, _valid_until date, _hospital_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_targets record;
  v_problems jsonb := '[]'::jsonb;
  v_today date := CURRENT_DATE;
  v_new_from date := COALESCE(_valid_from, v_today);
  v_new_until date := _valid_until;
  v_crm text; v_ckey text; v_other record; v_overlap boolean;
  v_hospital uuid := _hospital_id;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT (public.has_role(v_actor, 'admin'::app_role) OR public.has_role(v_actor, 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para validar regras' USING ERRCODE = '42501';
  END IF;
  IF v_hospital IS NULL AND _rule_id IS NOT NULL THEN
    SELECT hospital_id INTO v_hospital FROM public.rules WHERE id = _rule_id;
  END IF;

  SELECT * INTO v_targets FROM public.extract_rule_targets(_scope, _target_type, _target_identifier, _target_company_id, _group_doctors, _group_company_links);

  IF v_targets.doctor_crms IS NOT NULL THEN
    FOREACH v_crm IN ARRAY v_targets.doctor_crms LOOP
      FOR v_other IN
        SELECT r.id, r.name, r.valid_from, r.valid_until FROM public.rules r
        WHERE r.active = true
          AND (v_hospital IS NULL OR r.hospital_id = v_hospital)
          AND (r.valid_until IS NULL OR r.valid_until >= v_today)
          AND (_rule_id IS NULL OR r.id <> _rule_id)
          AND (
            (r.scope = 'especifica'::public.rule_scope AND r.target_type = 'medico'::public.rule_target_type AND public.only_digits(r.target_identifier) = v_crm)
            OR (r.scope = 'grupo'::public.rule_scope AND EXISTS (
              SELECT 1 FROM public.extract_rule_targets(r.scope, r.target_type, r.target_identifier, r.target_company_id, r.group_doctors, r.group_company_links) t WHERE v_crm = ANY(t.doctor_crms)
            ))
          )
      LOOP
        v_problems := v_problems || jsonb_build_object('type','doctor_already_bound','doctor_crm',v_crm,'existing_rule_id',v_other.id,'existing_rule_name',v_other.name,'existing_valid_from',v_other.valid_from,'existing_valid_until',v_other.valid_until);
        v_overlap := ((v_other.valid_until IS NULL OR v_other.valid_until >= v_new_from) AND (v_new_until IS NULL OR v_new_until >= COALESCE(v_other.valid_from, v_today)));
        IF v_overlap THEN
          v_problems := v_problems || jsonb_build_object('type','validity_overlap','doctor_crm',v_crm,'existing_rule_id',v_other.id,'existing_rule_name',v_other.name,'existing_valid_from',v_other.valid_from,'existing_valid_until',v_other.valid_until,'suggested_valid_until',(v_new_from - 1));
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF v_targets.company_keys IS NOT NULL THEN
    FOREACH v_ckey IN ARRAY v_targets.company_keys LOOP
      FOR v_other IN
        SELECT r.id, r.name, r.valid_from, r.valid_until FROM public.rules r
        WHERE r.active = true
          AND (v_hospital IS NULL OR r.hospital_id = v_hospital)
          AND (r.valid_until IS NULL OR r.valid_until >= v_today)
          AND (_rule_id IS NULL OR r.id <> _rule_id)
          AND (
            (r.scope = 'especifica'::public.rule_scope AND r.target_type = 'empresa'::public.rule_target_type AND (r.target_company_id::text = v_ckey OR public.only_digits(r.target_identifier) = v_ckey))
            OR (r.scope = 'grupo'::public.rule_scope AND EXISTS (
              SELECT 1 FROM public.extract_rule_targets(r.scope, r.target_type, r.target_identifier, r.target_company_id, r.group_doctors, r.group_company_links) t WHERE v_ckey = ANY(t.company_keys)
            ))
          )
      LOOP
        v_problems := v_problems || jsonb_build_object('type','company_already_bound','company_key',v_ckey,'existing_rule_id',v_other.id,'existing_rule_name',v_other.name,'existing_valid_from',v_other.valid_from,'existing_valid_until',v_other.valid_until);
        v_overlap := ((v_other.valid_until IS NULL OR v_other.valid_until >= v_new_from) AND (v_new_until IS NULL OR v_new_until >= COALESCE(v_other.valid_from, v_today)));
        IF v_overlap THEN
          v_problems := v_problems || jsonb_build_object('type','validity_overlap','company_key',v_ckey,'existing_rule_id',v_other.id,'existing_rule_name',v_other.name,'existing_valid_from',v_other.valid_from,'existing_valid_until',v_other.valid_until,'suggested_valid_until',(v_new_from - 1));
        END IF;
      END LOOP;
    END LOOP;
  END IF;

  IF _scope = 'master'::public.rule_scope THEN
    FOR v_other IN
      SELECT r.id, r.name, r.valid_from, r.valid_until FROM public.rules r
      WHERE r.active = true AND r.scope = 'master'::public.rule_scope
        AND (v_hospital IS NULL OR r.hospital_id = v_hospital)
        AND (r.valid_until IS NULL OR r.valid_until >= v_today)
        AND (_rule_id IS NULL OR r.id <> _rule_id)
    LOOP
      v_overlap := ((v_other.valid_until IS NULL OR v_other.valid_until >= v_new_from) AND (v_new_until IS NULL OR v_new_until >= COALESCE(v_other.valid_from, v_today)));
      IF v_overlap THEN
        v_problems := v_problems || jsonb_build_object('type','master_already_exists','existing_rule_id',v_other.id,'existing_rule_name',v_other.name,'existing_valid_from',v_other.valid_from,'existing_valid_until',v_other.valid_until,'suggested_valid_until',(v_new_from - 1));
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('valid', (jsonb_array_length(v_problems) = 0), 'problems', v_problems);
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_rule_save(uuid, public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_rule_save(uuid, public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb, date, date, uuid) TO authenticated;

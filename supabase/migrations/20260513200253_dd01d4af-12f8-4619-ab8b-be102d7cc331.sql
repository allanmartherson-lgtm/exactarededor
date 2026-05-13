-- Sub-Onda 2D / Rodada 2 — Fix em validate_rule_save:
-- subqueries `v_crm = ANY((SELECT array_col FROM extract_rule_targets(...)))`
-- estavam comparando text com text[]. Trocamos por
-- `EXISTS (SELECT 1 FROM extract_rule_targets(...) t WHERE v_crm = ANY(t.doctor_crms))`
-- (e equivalente para company_keys), que é o uso correto.

CREATE OR REPLACE FUNCTION public.validate_rule_save(
  _rule_id uuid,
  _scope rule_scope,
  _target_type rule_target_type,
  _target_identifier text,
  _target_company_id uuid,
  _group_doctors jsonb,
  _group_company_links jsonb,
  _valid_from date,
  _valid_until date
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_targets record;
  v_problems jsonb := '[]'::jsonb;
  v_today date := CURRENT_DATE;
  v_new_from date := COALESCE(_valid_from, v_today);
  v_new_until date := _valid_until;
  v_crm text;
  v_ckey text;
  v_other record;
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

  -- Verificação A — médico
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
             AND EXISTS (
               SELECT 1
               FROM public.extract_rule_targets(
                 r.scope, r.target_type, r.target_identifier, r.target_company_id,
                 r.group_doctors, r.group_company_links
               ) t
               WHERE v_crm = ANY(t.doctor_crms)
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

        v_overlap := (
          (v_other.valid_until IS NULL OR v_other.valid_until >= v_new_from)
          AND
          (v_new_until IS NULL OR v_new_until >= COALESCE(v_other.valid_from, v_today))
        );
        IF v_overlap THEN
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

  -- Verificação B — empresa
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
             AND EXISTS (
               SELECT 1
               FROM public.extract_rule_targets(
                 r.scope, r.target_type, r.target_identifier, r.target_company_id,
                 r.group_doctors, r.group_company_links
               ) t
               WHERE v_ckey = ANY(t.company_keys)
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

  -- master_already_exists
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
$function$;
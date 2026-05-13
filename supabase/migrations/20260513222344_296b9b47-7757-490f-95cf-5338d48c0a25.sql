-- Permite que a mesma empresa apareça em mais de uma regra ativa
-- desde que os médicos cobertos não se sobreponham.
--
-- Mudanças:
--  1) extract_rule_targets ganha coluna company_keys_all_doctors:
--     companies vinculadas SEM lista específica de médicos
--     (= "todos os médicos da empresa").
--  2) validate_rule_save passa a só emitir company_already_bound quando
--     pelo menos um dos lados (nova regra ou existente) cobre a empresa
--     com "todos os médicos". Quando os dois lados têm listas específicas,
--     a verificação de médico (doctor_already_bound) já cobre eventuais
--     sobreposições reais de CRM — sem falso-positivo de empresa.

DROP FUNCTION IF EXISTS public.extract_rule_targets(
  public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION public.extract_rule_targets(
  _scope               public.rule_scope,
  _target_type         public.rule_target_type,
  _target_identifier   text,
  _target_company_id   uuid,
  _group_doctors       jsonb,
  _group_company_links jsonb
)
RETURNS TABLE(
  doctor_crms text[],
  company_keys text[],
  company_keys_all_doctors text[]
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_doctors text[] := ARRAY[]::text[];
  v_companies text[] := ARRAY[]::text[];
  v_companies_all text[] := ARRAY[]::text[];
  v_d_norm text;
  v_c_key text;
  v_link jsonb;
  v_inner jsonb;
  v_has_doctors boolean;
BEGIN
  IF _scope = 'master'::public.rule_scope THEN
    doctor_crms := v_doctors;
    company_keys := v_companies;
    company_keys_all_doctors := v_companies_all;
    RETURN NEXT; RETURN;
  END IF;

  IF _scope = 'especifica'::public.rule_scope THEN
    IF _target_type = 'medico'::public.rule_target_type THEN
      v_d_norm := public.only_digits(_target_identifier);
      IF coalesce(v_d_norm,'') <> '' THEN
        v_doctors := array_append(v_doctors, v_d_norm);
      END IF;
    ELSIF _target_type = 'empresa'::public.rule_target_type THEN
      -- empresa específica = vincula a empresa inteira (todos os médicos)
      IF _target_company_id IS NOT NULL THEN
        v_companies := array_append(v_companies, _target_company_id::text);
        v_companies_all := array_append(v_companies_all, _target_company_id::text);
      ELSE
        v_c_key := public.only_digits(_target_identifier);
        IF coalesce(v_c_key,'') <> '' THEN
          v_companies := array_append(v_companies, v_c_key);
          v_companies_all := array_append(v_companies_all, v_c_key);
        END IF;
      END IF;
    END IF;
  ELSIF _scope = 'grupo'::public.rule_scope THEN
    IF jsonb_typeof(_group_doctors) = 'array' THEN
      FOR v_inner IN SELECT * FROM jsonb_array_elements(_group_doctors) LOOP
        v_d_norm := public.only_digits(v_inner->>'crm');
        IF coalesce(v_d_norm,'') <> '' THEN
          v_doctors := array_append(v_doctors, v_d_norm);
        END IF;
      END LOOP;
    END IF;

    IF jsonb_typeof(_group_company_links) = 'array' THEN
      FOR v_link IN SELECT * FROM jsonb_array_elements(_group_company_links) LOOP
        IF (v_link->>'company_id') IS NOT NULL AND (v_link->>'company_id') <> '' THEN
          v_companies := array_append(v_companies, v_link->>'company_id');
          v_has_doctors := (
            jsonb_typeof(v_link->'doctors') = 'array'
            AND jsonb_array_length(v_link->'doctors') > 0
          );
          IF NOT v_has_doctors THEN
            v_companies_all := array_append(v_companies_all, v_link->>'company_id');
          END IF;
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

  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::text[]) INTO doctor_crms FROM unnest(v_doctors) x;
  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::text[]) INTO company_keys FROM unnest(v_companies) x;
  SELECT coalesce(array_agg(DISTINCT x), ARRAY[]::text[]) INTO company_keys_all_doctors FROM unnest(v_companies_all) x;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.extract_rule_targets(public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.extract_rule_targets(public.rule_scope, public.rule_target_type, text, uuid, jsonb, jsonb) TO authenticated;


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
  v_is_new_all boolean;
  v_is_other_all boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_actor, 'admin'::app_role) OR public.has_role(v_actor, 'diretor'::app_role)) THEN
    RAISE EXCEPTION 'Sem permissão para validar regras' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_targets
  FROM public.extract_rule_targets(_scope, _target_type, _target_identifier, _target_company_id, _group_doctors, _group_company_links);

  -- Verificação A — médico (CRM em comum)
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
  -- Só dispara company_already_bound quando pelo menos UM dos lados
  -- cobre a empresa com "todos os médicos". Caso contrário (ambos com
  -- listas específicas), a Verificação A já cobre conflitos reais por CRM.
  IF v_targets.company_keys IS NOT NULL THEN
    FOREACH v_ckey IN ARRAY v_targets.company_keys LOOP
      v_is_new_all := v_ckey = ANY(COALESCE(v_targets.company_keys_all_doctors, ARRAY[]::text[]));

      FOR v_other IN
        SELECT
          r.id, r.name, r.valid_from, r.valid_until,
          (
            SELECT v_ckey = ANY(t.company_keys_all_doctors)
            FROM public.extract_rule_targets(
              r.scope, r.target_type, r.target_identifier, r.target_company_id,
              r.group_doctors, r.group_company_links
            ) t
          ) AS other_is_all
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
        v_is_other_all := COALESCE(v_other.other_is_all, false);

        -- Sem conflito de empresa quando ambos os lados têm doctor list específica.
        IF NOT (v_is_new_all OR v_is_other_all) THEN
          CONTINUE;
        END IF;

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
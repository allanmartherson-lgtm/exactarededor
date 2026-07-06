DO $$
BEGIN
  PERFORM set_config('app.rule_calc_delete_authorized', 'on', true);

  INSERT INTO public.rule_snapshots (rule_id, hospital_id, reason, payload, calc_count, actor_id)
  SELECT
    r.id,
    r.hospital_id,
    'manual_backup',
    COALESCE(jsonb_agg(to_jsonb(rc.*) ORDER BY rc.sort_order) FILTER (WHERE rc.id IS NOT NULL), '[]'::jsonb),
    COUNT(rc.id)::int,
    NULL
  FROM public.rules r
  LEFT JOIN public.rule_calculations rc ON rc.rule_id = r.id
  WHERE r.code IN ('HSL-R001','HSL-R002','HSL-R010','HSH-R001','HSH-R002','HSH-R010')
  GROUP BY r.id, r.hospital_id;

  DELETE FROM public.rule_calculations
  WHERE rule_id IN (
    SELECT id FROM public.rules
    WHERE code IN ('HSL-R001','HSL-R002','HSL-R010','HSH-R001','HSH-R002','HSH-R010')
  );

  WITH mapping(src_code, dst_code) AS (
    VALUES
      ('DFS-R001','HSL-R001'), ('DFS-R001','HSH-R001'),
      ('DFS-R002','HSL-R002'), ('DFS-R002','HSH-R002'),
      ('DFS-R010','HSL-R010'), ('DFS-R010','HSH-R010')
  ),
  src AS (SELECT code, id AS rule_id FROM public.rules WHERE code LIKE 'DFS-R%'),
  dst AS (SELECT code, id AS rule_id, hospital_id FROM public.rules WHERE code LIKE 'HSL-R%' OR code LIKE 'HSH-R%')
  INSERT INTO public.rule_calculations (
    id, rule_id, hospital_id, sort_order, label, calculation_type,
    fixed_amount, target_amount, multiplier, deflator_pct, bonus_amount, bonus_pct,
    reference_table_id, repasse_pct, convenio_percentage, auxiliary_pct, aux_first_pct,
    aux_second_pct, instrumentador_pct, include_auxiliaries, package_amount,
    package_subtype, package_main_code, package_included_codes, package_auxiliaries_included,
    package_opinions_count, package_visits_count, extras_codes, apply_access_route,
    time_mode, weekdays, time_start, time_end, includes_holidays, elective_mode,
    allowed_access_routes, has_conditions, sectors, specialties, force_totalized,
    application_unit, procedure_codes, code_match_mode, doctor_roles,
    agreement_match_mode, agreement_aliases, acrescimo_pct, procedure_keywords,
    context_conditions, package_roles_distribution, adicional_fds_pct,
    adicional_feriado_pct, adicional_noturno_pct, noturno_inicio, noturno_fim,
    is_catch_all, fixed_amount_by_role, special_case_filter, match_by_specialty,
    item_type_id
  )
  SELECT
    gen_random_uuid(),
    dst.rule_id,
    dst.hospital_id,
    rc.sort_order, rc.label, rc.calculation_type,
    rc.fixed_amount, rc.target_amount, rc.multiplier, rc.deflator_pct, rc.bonus_amount, rc.bonus_pct,
    CASE
      WHEN rc.reference_table_id = '8222f3e5-5c89-4eea-bc01-02ee88c85cf5'::uuid
           AND dst.hospital_id = 'fe55d20f-0d4f-477f-871d-e53866f6b02c'::uuid
        THEN '264cc280-6ad6-4018-a503-31bb3a126695'::uuid
      WHEN rc.reference_table_id = '8222f3e5-5c89-4eea-bc01-02ee88c85cf5'::uuid
           AND dst.hospital_id = '9168b14a-6974-4a58-9276-92b49a6fe316'::uuid
        THEN 'e39d029e-a40c-4160-9bd4-ece7082549a5'::uuid
      ELSE rc.reference_table_id
    END,
    rc.repasse_pct, rc.convenio_percentage, rc.auxiliary_pct, rc.aux_first_pct,
    rc.aux_second_pct, rc.instrumentador_pct, rc.include_auxiliaries, rc.package_amount,
    rc.package_subtype, rc.package_main_code, rc.package_included_codes, rc.package_auxiliaries_included,
    rc.package_opinions_count, rc.package_visits_count, rc.extras_codes, rc.apply_access_route,
    rc.time_mode, rc.weekdays, rc.time_start, rc.time_end, rc.includes_holidays, rc.elective_mode,
    rc.allowed_access_routes, rc.has_conditions, rc.sectors, rc.specialties, rc.force_totalized,
    rc.application_unit, rc.procedure_codes, rc.code_match_mode, rc.doctor_roles,
    rc.agreement_match_mode, rc.agreement_aliases, rc.acrescimo_pct, rc.procedure_keywords,
    rc.context_conditions, rc.package_roles_distribution, rc.adicional_fds_pct,
    rc.adicional_feriado_pct, rc.adicional_noturno_pct, rc.noturno_inicio, rc.noturno_fim,
    rc.is_catch_all, rc.fixed_amount_by_role, rc.special_case_filter, rc.match_by_specialty,
    rc.item_type_id
  FROM mapping m
  JOIN src ON src.code = m.src_code
  JOIN dst ON dst.code = m.dst_code
  JOIN public.rule_calculations rc ON rc.rule_id = src.rule_id;

  PERFORM set_config('app.rule_calc_delete_authorized', 'off', true);
END $$;
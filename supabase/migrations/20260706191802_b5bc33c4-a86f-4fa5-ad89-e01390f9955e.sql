
DO $$
DECLARE cbhpm_dfs uuid := '8222f3e5-5c89-4eea-bc01-02ee88c85cf5';
        cbhpm_hsl uuid := '264cc280-6ad6-4018-a503-31bb3a126695';
        cbhpm_hsh uuid := 'e39d029e-a40c-4160-9bd4-ece7082549a5';
        hsl_id uuid := 'fe55d20f-0d4f-477f-871d-e53866f6b02c';
        hsh_id uuid := '9168b14a-6974-4a58-9276-92b49a6fe316';
BEGIN
  SET LOCAL app.rule_calc_delete_authorized = 'on';

  INSERT INTO rule_snapshots(rule_id, hospital_id, reason, payload, calc_count)
  SELECT r.id, r.hospital_id, 'pre_bulk_copy_from_dfs_20260706b',
         jsonb_build_object('calcs', jsonb_agg(to_jsonb(rc.*))),
         count(*)
  FROM rules r
  JOIN rule_calculations rc ON rc.rule_id = r.id
  WHERE r.hospital_id IN (hsl_id, hsh_id)
    AND r.code ~ '^(HSL|HSH)-R(003|004|005|006|007|008|009|011|012|013|014|015|016|017|018|019|020|021|022|023|024|025|026|027|028)$'
  GROUP BY r.id, r.hospital_id;

  DELETE FROM rule_calculations rc
  USING rules r
  WHERE rc.rule_id = r.id
    AND r.hospital_id IN (hsl_id, hsh_id)
    AND r.code ~ '^(HSL|HSH)-R(003|004|005|006|007|008|009|011|012|013|014|015|016|017|018|019|020|021|022|023|024|025|026|027|028)$';

  INSERT INTO rule_calculations (
    rule_id, sort_order, label, calculation_type, fixed_amount, target_amount, multiplier, deflator_pct,
    bonus_amount, bonus_pct, reference_table_id, repasse_pct, convenio_percentage, auxiliary_pct,
    aux_first_pct, aux_second_pct, instrumentador_pct, include_auxiliaries, package_amount, package_subtype,
    package_main_code, package_included_codes, package_auxiliaries_included, package_opinions_count,
    package_visits_count, extras_codes, apply_access_route, time_mode, weekdays, time_start, time_end,
    includes_holidays, elective_mode, allowed_access_routes, has_conditions, sectors, specialties,
    force_totalized, application_unit, procedure_codes, code_match_mode, doctor_roles, agreement_match_mode,
    agreement_aliases, acrescimo_pct, procedure_keywords, context_conditions, hospital_id,
    package_roles_distribution, adicional_fds_pct, adicional_feriado_pct, adicional_noturno_pct,
    noturno_inicio, noturno_fim, is_catch_all, fixed_amount_by_role, special_case_filter,
    match_by_specialty, item_type_id
  )
  SELECT
    dest.id, rc.sort_order, rc.label, rc.calculation_type, rc.fixed_amount, rc.target_amount, rc.multiplier, rc.deflator_pct,
    rc.bonus_amount, rc.bonus_pct,
    CASE
      WHEN rc.reference_table_id = cbhpm_dfs AND dest.hospital_id = hsl_id THEN cbhpm_hsl
      WHEN rc.reference_table_id = cbhpm_dfs AND dest.hospital_id = hsh_id THEN cbhpm_hsh
      ELSE rc.reference_table_id
    END,
    rc.repasse_pct, rc.convenio_percentage, rc.auxiliary_pct,
    rc.aux_first_pct, rc.aux_second_pct, rc.instrumentador_pct, rc.include_auxiliaries, rc.package_amount, rc.package_subtype,
    rc.package_main_code, rc.package_included_codes, rc.package_auxiliaries_included, rc.package_opinions_count,
    rc.package_visits_count, rc.extras_codes, rc.apply_access_route, rc.time_mode, rc.weekdays, rc.time_start, rc.time_end,
    rc.includes_holidays, rc.elective_mode, rc.allowed_access_routes, rc.has_conditions, rc.sectors, rc.specialties,
    rc.force_totalized, rc.application_unit, rc.procedure_codes, rc.code_match_mode, rc.doctor_roles, rc.agreement_match_mode,
    rc.agreement_aliases, rc.acrescimo_pct, rc.procedure_keywords, rc.context_conditions, dest.hospital_id,
    rc.package_roles_distribution, rc.adicional_fds_pct, rc.adicional_feriado_pct, rc.adicional_noturno_pct,
    rc.noturno_inicio, rc.noturno_fim, rc.is_catch_all, rc.fixed_amount_by_role, rc.special_case_filter,
    rc.match_by_specialty, rc.item_type_id
  FROM rules src
  JOIN rule_calculations rc ON rc.rule_id = src.id
  JOIN rules dest ON substring(dest.code from 5) = substring(src.code from 5)
                 AND dest.hospital_id IN (hsl_id, hsh_id)
  WHERE src.code ~ '^DFS-R(003|004|005|006|007|008|009|011|012|013|014|015|016|017|018|019|020|021|022|023|024|025|026|027|028)$'
    AND (rc.reference_table_id IS NULL
         OR rc.reference_table_id = cbhpm_dfs
         OR src.code <> 'DFS-R008');
END $$;

-- Backfill: cria 1 rule_calculation por regra que ainda não tenha itens
INSERT INTO public.rule_calculations (
  rule_id, label, sort_order, calculation_type,
  time_mode, time_start, time_end, weekdays, includes_holidays, elective_mode,
  fixed_amount, target_amount, multiplier, deflator_pct,
  bonus_amount, bonus_pct, reference_table_id, repasse_pct, convenio_percentage,
  auxiliary_pct, aux_first_pct, aux_second_pct, instrumentador_pct, include_auxiliaries,
  package_amount, package_subtype, package_main_code, package_included_codes,
  package_auxiliaries_included, package_visits_count, package_opinions_count,
  apply_access_route, extras_codes
)
SELECT
  r.id,
  'Cálculo principal',
  0,
  r.calculation_type,
  COALESCE(r.time_mode, 'qualquer'),
  r.time_start, r.time_end,
  COALESCE(r.weekdays, '{}'::smallint[]),
  COALESCE(r.includes_holidays, false),
  COALESCE(r.elective_mode, 'qualquer'),
  r.fixed_amount, r.target_amount, r.multiplier, r.deflator_pct,
  r.bonus_amount, r.bonus_pct, r.reference_table_id, r.repasse_pct, r.convenio_percentage,
  r.auxiliary_pct, r.aux_first_pct, r.aux_second_pct, r.instrumentador_pct,
  COALESCE(r.include_auxiliaries, false),
  r.package_amount, r.package_subtype, r.package_main_code, r.package_included_codes,
  COALESCE(r.package_auxiliaries_included, true),
  COALESCE(r.package_visits_count, false),
  COALESCE(r.package_opinions_count, false),
  COALESCE(r.apply_access_route, false),
  r.extras_codes
FROM public.rules r
WHERE NOT EXISTS (
  SELECT 1 FROM public.rule_calculations rc WHERE rc.rule_id = r.id
);
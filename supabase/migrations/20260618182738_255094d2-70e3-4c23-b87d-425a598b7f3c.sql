
WITH src AS (
  SELECT
    id,
    package_amount,
    package_main_code,
    package_roles_distribution,
    (
      SELECT array_agg(trim(x))
      FROM regexp_split_to_table(coalesce(package_main_code, ''), '\s*,\s*') AS x
      WHERE trim(x) <> ''
    ) AS new_proc_codes,
    (SELECT (elem->>'value')::numeric FROM jsonb_array_elements(package_roles_distribution) elem WHERE elem->>'role_key' = 'cirurgiao' LIMIT 1) AS v_cirurgiao,
    (SELECT (elem->>'value')::numeric FROM jsonb_array_elements(package_roles_distribution) elem WHERE elem->>'role_key' = 'aux1' LIMIT 1) AS v_aux1,
    (SELECT (elem->>'value')::numeric FROM jsonb_array_elements(package_roles_distribution) elem WHERE elem->>'role_key' = 'aux2' LIMIT 1) AS v_aux2
  FROM public.rule_calculations
  WHERE calculation_type = 'pacote' AND label ILIKE 'Excedente%'
)
UPDATE public.rule_calculations rc
SET
  calculation_type = 'valor_fixo',
  fixed_amount = COALESCE(NULLIF(src.v_cirurgiao, 0), src.package_amount),
  fixed_amount_by_role = jsonb_strip_nulls(jsonb_build_object(
    'cirurgiao',    CASE WHEN src.v_cirurgiao IS NOT NULL AND src.v_cirurgiao <> 0 THEN src.v_cirurgiao END,
    'primeiro_aux', CASE WHEN src.v_aux1      IS NOT NULL AND src.v_aux1      <> 0 THEN src.v_aux1      END,
    'demais_aux',   CASE WHEN src.v_aux2      IS NOT NULL AND src.v_aux2      <> 0 THEN src.v_aux2      END
  )),
  procedure_codes = COALESCE(src.new_proc_codes, rc.procedure_codes),
  code_match_mode = COALESCE(rc.code_match_mode, 'any'),
  package_amount = NULL,
  package_subtype = NULL,
  package_main_code = NULL,
  package_included_codes = NULL,
  package_roles_distribution = NULL,
  updated_at = now()
FROM src
WHERE rc.id = src.id;

UPDATE public.rule_calculations
SET code_match_mode = 'whitelist', updated_at = now()
WHERE calculation_type = 'valor_fixo'
  AND label ILIKE 'Excedente%'
  AND coalesce(code_match_mode, 'any') = 'any'
  AND procedure_codes IS NOT NULL
  AND array_length(procedure_codes, 1) >= 1;
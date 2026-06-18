UPDATE public.payment_items
SET tipo_linha = 'procedimento',
    applied_rule_id = NULL,
    applied_calc_id = NULL,
    applied_calc_method = NULL,
    expected_amount = NULL,
    ai_status = 'pendente'
WHERE tipo_linha = 'complemento_bonus'
  AND procedure_code IS NOT NULL
  AND TRIM(procedure_code) <> '';
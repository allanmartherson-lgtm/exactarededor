-- Adiciona suporte a "valor fixo por função" em rule_calculations.
-- JSONB no formato: { "cirurgiao": number, "primeiro_aux": number, "demais_aux": number, "instrumentador": number, "outro": number }
-- Quando vazio/nulo, motor usa fixed_amount global. Chaves espelham classifyDoctorRole().
ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS fixed_amount_by_role JSONB;

COMMENT ON COLUMN public.rule_calculations.fixed_amount_by_role IS
  'Valor fixo por função médica (cirurgiao, primeiro_aux, demais_aux, instrumentador, outro). Sobrescreve fixed_amount quando a função do item bate. Vazio = usa fixed_amount global.';
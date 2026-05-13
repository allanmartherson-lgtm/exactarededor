ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS acrescimo_pct numeric;

COMMENT ON COLUMN public.rule_calculations.acrescimo_pct IS
  'Acréscimo aditivo aplicado no final do cálculo de tabela_diferenciada, antes do deflator. Ex.: 20 = +20% sobre o valor calculado até a quantidade. Diferente de repasse_pct (que é multiplicativo / share do médico).';
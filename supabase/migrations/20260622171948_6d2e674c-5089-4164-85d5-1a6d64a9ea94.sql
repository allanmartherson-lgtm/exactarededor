ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS special_case_filter text[];

COMMENT ON COLUMN public.rule_calculations.special_case_filter IS
  'Filtro opcional de caso especial por cálculo. NULL/vazio = cálculo padrão; códigos ou * = só aplica a itens com caso especial aprovado correspondente.';

UPDATE public.rule_calculations
SET special_case_filter = ARRAY['oncologico']::text[]
WHERE id = '5d803900-cfc5-48f4-99c6-a603bc2c6d14'
  AND rule_id = '9458f70b-efd6-4f6b-85e9-27519727a9a4';

UPDATE public.rules
SET special_case_filter = NULL
WHERE id = '9458f70b-efd6-4f6b-85e9-27519727a9a4'
  AND special_case_filter = ARRAY['oncologico']::text[];
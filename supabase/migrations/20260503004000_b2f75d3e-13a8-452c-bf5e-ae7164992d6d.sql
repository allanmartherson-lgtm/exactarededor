-- Unifica os tipos de pacote em um único método "pacote" com subtipo.
ALTER TYPE public.rule_calculation_type ADD VALUE IF NOT EXISTS 'pacote';

-- Subtipo do pacote: fechado ou com_extras
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS package_subtype text;

-- Comentário para documentação
COMMENT ON COLUMN public.rules.package_subtype IS
  'Subtipo do pacote quando calculation_type = pacote: "fechado" ou "com_extras". Cálculo sempre opera no nível do atendimento.';

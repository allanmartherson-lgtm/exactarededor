ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS application_unit text NOT NULL DEFAULT 'por_item';

ALTER TABLE public.rule_calculations
  DROP CONSTRAINT IF EXISTS rule_calculations_application_unit_check;

ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_application_unit_check
  CHECK (application_unit IN ('por_item', 'por_atendimento', 'por_paciente_dia'));
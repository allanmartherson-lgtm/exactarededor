ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS case_subtype text;

ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_case_subtype_check
  CHECK (case_subtype IS NULL OR case_subtype IN ('parecer','visita'));

CREATE INDEX IF NOT EXISTS idx_rule_calculations_case_subtype ON public.rule_calculations (case_subtype);

COMMENT ON COLUMN public.rule_calculations.case_subtype IS 'NULL = vale para qualquer subtipo dentro do payment_type. Setado = só casa com itens marcados com esse subtipo.';

ALTER TYPE public.rule_calculation_type ADD VALUE IF NOT EXISTS 'pacote_por_atendimento';

ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS package_main_code text,
  ADD COLUMN IF NOT EXISTS package_included_codes text[],
  ADD COLUMN IF NOT EXISTS package_visits_count boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_opinions_count boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_auxiliaries_included boolean NOT NULL DEFAULT true;

ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS has_conditions BOOLEAN DEFAULT false;
ALTER TABLE public.rule_calculations ADD COLUMN IF NOT EXISTS has_conditions BOOLEAN DEFAULT false;
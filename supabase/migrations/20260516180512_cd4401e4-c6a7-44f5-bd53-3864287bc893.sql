ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS context_conditions jsonb NOT NULL DEFAULT '[]'::jsonb;
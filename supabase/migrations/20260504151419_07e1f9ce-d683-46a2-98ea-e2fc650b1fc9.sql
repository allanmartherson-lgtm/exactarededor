-- 1) Novo valor no enum rule_scope
ALTER TYPE public.rule_scope ADD VALUE IF NOT EXISTS 'grupo';

-- 2) Novos campos para escopo grupo (inline) e auxiliares estruturados
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS group_company_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS group_doctors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS aux_first_pct numeric,
  ADD COLUMN IF NOT EXISTS aux_second_pct numeric,
  ADD COLUMN IF NOT EXISTS instrumentador_pct numeric;

-- 3) Índice GIN para busca por empresa do grupo
CREATE INDEX IF NOT EXISTS idx_rules_group_company_ids
  ON public.rules USING GIN (group_company_ids);
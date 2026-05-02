ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS repasse_pct numeric,
  ADD COLUMN IF NOT EXISTS apply_access_route boolean NOT NULL DEFAULT false;
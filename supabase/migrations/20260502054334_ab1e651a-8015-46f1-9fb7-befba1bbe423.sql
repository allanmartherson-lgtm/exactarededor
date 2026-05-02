ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.preferences IS
  'Preferências de UI persistidas por usuário (ex.: dashboard.pipelineLayout, dashboard.pipelineOwner, dashboard.pipelineWindow). Cliente faz merge raso por chave.';

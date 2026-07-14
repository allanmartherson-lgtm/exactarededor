
CREATE TABLE public.ai_checklist_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hospital_id UUID NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('company','payment_lot')),
  scope_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  result JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_checklist_cache_unique UNIQUE (hospital_id, scope, scope_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_checklist_cache TO service_role;

ALTER TABLE public.ai_checklist_cache ENABLE ROW LEVEL SECURITY;

-- fail-closed: nenhuma policy para authenticated/anon; só service_role acessa (bypass RLS).

CREATE TRIGGER update_ai_checklist_cache_updated_at
BEFORE UPDATE ON public.ai_checklist_cache
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

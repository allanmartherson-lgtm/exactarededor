-- Fase 1: Rules
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS sectors text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_until date,
  ADD COLUMN IF NOT EXISTS doctors jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill sectors a partir do sector atual (enum -> text)
UPDATE public.rules
   SET sectors = ARRAY[sector::text]
 WHERE (sectors IS NULL OR array_length(sectors, 1) IS NULL)
   AND sector IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rules_sectors ON public.rules USING GIN (sectors);
CREATE INDEX IF NOT EXISTS idx_rules_specialties ON public.rules USING GIN (specialties);
CREATE INDEX IF NOT EXISTS idx_rules_valid_range ON public.rules (valid_from, valid_until);

-- Fase 2: Payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS sectors text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_payments_sectors ON public.payments USING GIN (sectors);
CREATE INDEX IF NOT EXISTS idx_payments_specialties ON public.payments USING GIN (specialties);
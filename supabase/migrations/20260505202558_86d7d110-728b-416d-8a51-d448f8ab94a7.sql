ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS agreement_name text,
  ADD COLUMN IF NOT EXISTS agreement_aliases text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_rules_agreement_name
  ON public.rules (lower(agreement_name))
  WHERE agreement_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rules_agreement_aliases
  ON public.rules USING GIN (agreement_aliases);

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS specialty text;

CREATE INDEX IF NOT EXISTS idx_payment_items_specialty
  ON public.payment_items (lower(specialty))
  WHERE specialty IS NOT NULL;
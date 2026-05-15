ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS validation_findings jsonb NOT NULL DEFAULT '[]'::jsonb;
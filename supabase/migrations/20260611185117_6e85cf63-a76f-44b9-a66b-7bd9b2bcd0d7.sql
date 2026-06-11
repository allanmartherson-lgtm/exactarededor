
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS gross_amount_original numeric,
  ADD COLUMN IF NOT EXISTS gross_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS gross_override_by uuid,
  ADD COLUMN IF NOT EXISTS gross_override_reason text;

CREATE INDEX IF NOT EXISTS idx_payment_items_gross_override
  ON public.payment_items(payment_id) WHERE gross_override_at IS NOT NULL;

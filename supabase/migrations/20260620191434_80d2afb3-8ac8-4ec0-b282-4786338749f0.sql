ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS manual_entry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payment_items_manual_entry
  ON public.payment_items(payment_id) WHERE manual_entry = true;
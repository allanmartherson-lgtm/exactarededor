ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_payment_type_override_source_check;

ALTER TABLE public.payment_items
  DROP COLUMN IF EXISTS payment_type_override_source,
  DROP COLUMN IF EXISTS payment_type_override_at,
  DROP COLUMN IF EXISTS payment_type_override_by;

DROP INDEX IF EXISTS public.payment_items_payment_type_override_idx;
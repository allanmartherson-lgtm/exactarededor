ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS payment_type_id uuid NULL REFERENCES public.payment_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_type_override_source text NULL,
  ADD COLUMN IF NOT EXISTS payment_type_override_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS payment_type_override_by uuid NULL;

ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_payment_type_override_source_check;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_payment_type_override_source_check
  CHECK (payment_type_override_source IS NULL OR payment_type_override_source IN ('manual','auto_tuss','auto_heuristic','zeev'));

CREATE INDEX IF NOT EXISTS payment_items_payment_type_override_idx
  ON public.payment_items (payment_id, payment_type_id)
  WHERE payment_type_id IS NOT NULL;

COMMENT ON COLUMN public.payment_items.payment_type_id IS 'Override de tipo por item (lote misto). NULL = herda payments.payment_type_id.';
COMMENT ON COLUMN public.payment_items.payment_type_override_source IS 'Origem do override: manual | auto_tuss | auto_heuristic | zeev.';
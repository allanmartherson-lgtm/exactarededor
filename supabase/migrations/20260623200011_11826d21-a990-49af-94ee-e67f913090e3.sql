ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS payment_type_source text;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_payment_type_source_check
  CHECK (payment_type_source IS NULL OR payment_type_source IN ('base','report_cross','manual','company_override','default'));

CREATE INDEX IF NOT EXISTS idx_payment_items_payment_type_source
  ON public.payment_items (payment_id, payment_type_source);

COMMENT ON COLUMN public.payment_items.payment_type_source IS 'Origem da classificação do payment_type_id deste item: base | report_cross | manual | company_override | default. Override manual nunca é sobrescrito por classificação automática.';
ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS source_file_name text;
ALTER TABLE public.payment_unmatched_items ADD COLUMN IF NOT EXISTS source_file_name text;
CREATE INDEX IF NOT EXISTS idx_payment_items_source_file_name ON public.payment_items(payment_id, source_file_name);
COMMENT ON COLUMN public.payment_items.source_file_name IS 'Nome do arquivo original importado (snapshot para auditoria pós-importação).';
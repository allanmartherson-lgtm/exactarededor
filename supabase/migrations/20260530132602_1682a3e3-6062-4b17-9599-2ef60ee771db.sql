-- Backup do valor original do setor antes da normalização em massa
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS sector_original text;

CREATE INDEX IF NOT EXISTS idx_payment_items_sector_original
  ON public.payment_items(sector_original)
  WHERE sector_original IS NOT NULL;

COMMENT ON COLUMN public.payment_items.sector_original IS
  'Valor bruto do setor antes da normalização para slug canônico (reversibilidade).';
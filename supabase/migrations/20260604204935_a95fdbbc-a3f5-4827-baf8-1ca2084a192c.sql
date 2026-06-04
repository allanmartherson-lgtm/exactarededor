ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'imported',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS manual_note text;

ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_source_check;
ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_source_check CHECK (source IN ('imported','manual'));

CREATE INDEX IF NOT EXISTS idx_payment_items_source_manual
  ON public.payment_items (payment_id) WHERE source = 'manual';

COMMENT ON COLUMN public.payment_items.source IS 'imported = veio da base hospitalar; manual = inclusão avulsa pelo analista';
COMMENT ON COLUMN public.payment_items.created_by_user_id IS 'Analista que incluiu o item manualmente (NULL para imported)';
COMMENT ON COLUMN public.payment_items.manual_note IS 'Justificativa da inclusão manual';
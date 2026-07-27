ALTER TABLE public.retroactive_reconciliation_items
  ADD COLUMN IF NOT EXISTS retroactive_target_company_id UUID REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS target_reassign_reason TEXT,
  ADD COLUMN IF NOT EXISTS target_reassigned_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS target_reassigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_retro_recon_items_target_company
  ON public.retroactive_reconciliation_items(retroactive_target_company_id)
  WHERE retroactive_target_company_id IS NOT NULL;

COMMENT ON COLUMN public.retroactive_reconciliation_items.retroactive_target_company_id IS
  'PJ escolhida pelo analista para receber a glosa quando o vínculo médico->PJ mudou desde o lote original. Quando NULL, usar company_id (PJ do lote original).';
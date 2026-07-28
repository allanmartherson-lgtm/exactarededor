ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS package_ambiguity jsonb;

CREATE INDEX IF NOT EXISTS idx_payment_items_package_ambiguity_pending
  ON public.payment_items (payment_id)
  WHERE package_ambiguity IS NOT NULL;

COMMENT ON COLUMN public.payment_items.package_ambiguity IS
  'Motor de pacotes: candidatos ambíguos (multi_anchor / no_anchor) e decisão do analista (resolved). Item com ambiguidade pendente é neutro em economia/perda.';
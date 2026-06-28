ALTER TABLE public.company_financial_adjustments
  ADD COLUMN IF NOT EXISTS payment_type_ids uuid[] NULL;

CREATE INDEX IF NOT EXISTS idx_cfa_payment_type_ids
  ON public.company_financial_adjustments USING gin (payment_type_ids);

COMMENT ON COLUMN public.company_financial_adjustments.payment_type_ids IS
  'Restringe a aplicação deste ajuste a lotes cujo payment_type_id esteja no array. NULL ou vazio = qualquer tipo de lote.';
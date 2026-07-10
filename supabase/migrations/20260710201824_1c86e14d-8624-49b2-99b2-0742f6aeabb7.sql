ALTER TABLE public.retroactive_reconciliations
  ADD COLUMN IF NOT EXISTS source_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_center_code TEXT,
  ADD COLUMN IF NOT EXISTS analysis_mode TEXT;

CREATE INDEX IF NOT EXISTS idx_retroactive_recon_cc_mode
  ON public.retroactive_reconciliations (hospital_id, cost_center_code, analysis_mode);

CREATE INDEX IF NOT EXISTS idx_retroactive_recon_source_payment
  ON public.retroactive_reconciliations (source_payment_id);

COMMENT ON COLUMN public.retroactive_reconciliations.source_payment_id IS 'Lote de pagamento que originou esta apuração retroativa (quando aplicável).';
COMMENT ON COLUMN public.retroactive_reconciliations.cost_center_code IS 'Centro de custos herdado do lote de origem. Usado para casar com o lote vigente da PJ no cálculo de parcelamento.';
COMMENT ON COLUMN public.retroactive_reconciliations.analysis_mode IS 'Trilha de análise (prioritaria/habitual) herdada do lote de origem.';

ALTER TABLE public.retroactive_reconciliations
  ALTER COLUMN doctor_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);

ALTER TABLE public.retroactive_reconciliations
  DROP CONSTRAINT IF EXISTS retro_recon_scope_chk;
ALTER TABLE public.retroactive_reconciliations
  ADD CONSTRAINT retro_recon_scope_chk
  CHECK (doctor_id IS NOT NULL OR company_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_retro_recon_company ON public.retroactive_reconciliations(company_id);

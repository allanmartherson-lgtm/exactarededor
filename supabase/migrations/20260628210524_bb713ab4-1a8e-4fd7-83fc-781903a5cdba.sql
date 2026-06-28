ALTER TABLE public.company_financial_adjustments
  ADD COLUMN IF NOT EXISTS recorrente boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS data_fim date NULL;
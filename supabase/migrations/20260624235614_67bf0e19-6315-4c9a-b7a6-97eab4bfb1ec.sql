
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS reclassified_from_parecer boolean NOT NULL DEFAULT false;

-- Índice para acelerar lookback de 7d (parecer prévio mesmo hospital/especialidade/data)
CREATE INDEX IF NOT EXISTS ix_payment_items_parecer_lookback
  ON public.payment_items (hospital_id, specialty, procedure_date)
  WHERE parecer_evidence = 'confirmed';

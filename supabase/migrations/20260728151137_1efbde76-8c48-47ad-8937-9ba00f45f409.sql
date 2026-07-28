ALTER TABLE public.hospital_settings
  ADD COLUMN IF NOT EXISTS min_payout_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_payout_brl numeric NOT NULL DEFAULT 0;

ALTER TABLE public.hospital_settings
  ADD CONSTRAINT hospital_settings_min_payout_pct_range
  CHECK (min_payout_pct >= 0 AND min_payout_pct <= 100);

ALTER TABLE public.hospital_settings
  ADD CONSTRAINT hospital_settings_min_payout_brl_nonneg
  CHECK (min_payout_brl >= 0);

COMMENT ON COLUMN public.hospital_settings.min_payout_pct IS 'Piso mínimo de repasse: percentual do líquido do lote que deve sempre sobrar para a PJ receber e emitir NF (0-100).';
COMMENT ON COLUMN public.hospital_settings.min_payout_brl IS 'Piso mínimo de repasse: valor absoluto em R$ que deve sempre sobrar para a PJ. Piso efetivo = max(min_payout_pct% do líquido, min_payout_brl).';
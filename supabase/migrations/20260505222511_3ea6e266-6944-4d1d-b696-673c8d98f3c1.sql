ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS agreement_match_mode text NOT NULL DEFAULT 'whitelist';

ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_agreement_match_mode_check;

ALTER TABLE public.rules
  ADD CONSTRAINT rules_agreement_match_mode_check
  CHECK (agreement_match_mode IN ('whitelist', 'blacklist'));
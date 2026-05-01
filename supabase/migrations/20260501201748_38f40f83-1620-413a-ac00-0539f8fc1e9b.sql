-- Prazo de pagamento aplicável à regra
DO $$ BEGIN
  CREATE TYPE public.rule_payment_term AS ENUM ('qualquer', 'prioridade', 'habitual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS payment_term public.rule_payment_term NOT NULL DEFAULT 'qualquer',
  ADD COLUMN IF NOT EXISTS applies_payment_types public.payment_type[] NULL;

COMMENT ON COLUMN public.rules.payment_term IS 'Restringe a regra ao prazo de pagamento da empresa (prioridade/habitual) ou aplica a qualquer.';
COMMENT ON COLUMN public.rules.applies_payment_types IS 'Lista de tipos de pagamento (remessa, produção, valor fixo, plantão, misto) em que a regra se aplica. NULL = qualquer.';

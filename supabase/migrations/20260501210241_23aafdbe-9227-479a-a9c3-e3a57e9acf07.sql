-- Remove 'misto' do enum payment_type (multi-seleção em regras já cobre o caso)
-- Recriar o enum sem 'misto'
ALTER TABLE public.payments ALTER COLUMN payment_type DROP DEFAULT;

-- Garantir que nenhum registro use 'misto' (defensivo)
UPDATE public.payments SET payment_type = NULL WHERE payment_type::text = 'misto';

-- Atualizar arrays applies_payment_types em rules removendo 'misto'
UPDATE public.rules
SET applies_payment_types = array_remove(applies_payment_types, 'misto'::public.payment_type)
WHERE 'misto' = ANY(applies_payment_types::text[]);

-- Recriar enum
ALTER TYPE public.payment_type RENAME TO payment_type_old;
CREATE TYPE public.payment_type AS ENUM ('producao', 'remessa', 'valor_fixo', 'plantao');

ALTER TABLE public.payments
  ALTER COLUMN payment_type TYPE public.payment_type
  USING payment_type::text::public.payment_type;

ALTER TABLE public.rules
  ALTER COLUMN applies_payment_types TYPE public.payment_type[]
  USING applies_payment_types::text[]::public.payment_type[];

DROP TYPE public.payment_type_old;
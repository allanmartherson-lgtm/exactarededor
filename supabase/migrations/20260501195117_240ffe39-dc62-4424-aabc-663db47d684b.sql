-- Renomear valor do enum payment_type: repasse -> remessa
ALTER TYPE public.payment_type RENAME VALUE 'repasse' TO 'remessa';

-- Adicionar campo de centro de custos
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS cost_center text;
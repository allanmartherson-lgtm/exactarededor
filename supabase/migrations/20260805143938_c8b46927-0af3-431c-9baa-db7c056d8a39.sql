ALTER TABLE public.payment_company_groups
  ADD COLUMN IF NOT EXISTS reprovado_total numeric NOT NULL DEFAULT 0;

ALTER TABLE public.payment_company_financials
  ADD COLUMN IF NOT EXISTS reprovados numeric NOT NULL DEFAULT 0;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reprovado_total numeric NOT NULL DEFAULT 0;
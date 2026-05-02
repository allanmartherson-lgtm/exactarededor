ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS company_name text;

CREATE INDEX IF NOT EXISTS idx_invoices_payment_company
  ON public.invoices (payment_id, company_id);
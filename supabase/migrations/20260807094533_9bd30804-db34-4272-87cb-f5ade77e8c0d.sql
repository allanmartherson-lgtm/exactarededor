ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'lancada';
ALTER TYPE public.invoice_status ADD VALUE IF NOT EXISTS 'paga';

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS erp_document_number text,
  ADD COLUMN IF NOT EXISTS erp_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS erp_posted_by uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by uuid;
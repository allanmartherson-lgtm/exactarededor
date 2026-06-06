
CREATE INDEX IF NOT EXISTS idx_payment_items_payment_company
  ON public.payment_items (payment_id, company_id);

CREATE INDEX IF NOT EXISTS idx_invoices_liberadas_payment_company
  ON public.invoices (payment_id, company_id)
  WHERE sent_at IS NOT NULL AND status <> 'cancelada';

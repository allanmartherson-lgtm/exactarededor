ALTER TABLE public.reconciliation_items DROP CONSTRAINT IF EXISTS reconciliation_items_status_check;
ALTER TABLE public.reconciliation_items ADD CONSTRAINT reconciliation_items_status_check
  CHECK (status = ANY (ARRAY['conciliado'::text, 'valor_divergente'::text, 'qtd_divergente'::text, 'so_hospital'::text, 'so_exacta'::text]));
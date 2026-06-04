alter table public.reconciliation_items
  add column if not exists valor_pago_exacta  numeric,
  add column if not exists valor_repasse_acordo numeric;
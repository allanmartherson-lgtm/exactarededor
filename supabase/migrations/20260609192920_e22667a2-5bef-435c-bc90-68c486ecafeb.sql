alter table public.retroactive_reconciliation_items
  add column if not exists claimed_quantity numeric,
  add column if not exists paid_quantity numeric,
  add column if not exists matched_payment_date date;
ALTER TABLE public.reconciliation_items
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS quantity numeric;
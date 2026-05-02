ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS recipient_cc text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS request_message text,
  ADD COLUMN IF NOT EXISTS items_count integer NOT NULL DEFAULT 0;
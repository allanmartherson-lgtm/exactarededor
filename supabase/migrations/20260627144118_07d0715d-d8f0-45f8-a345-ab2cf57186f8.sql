ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS manual_general_attachment_path text,
  ADD COLUMN IF NOT EXISTS manual_general_attachment_name text;
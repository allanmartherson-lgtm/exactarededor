ALTER TABLE public.user_company_notes
  ADD COLUMN IF NOT EXISTS waiting_info TEXT NOT NULL DEFAULT '';
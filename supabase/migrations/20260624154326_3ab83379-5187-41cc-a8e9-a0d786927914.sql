
ALTER TABLE public.pool_deduction_values
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_size bigint,
  ADD COLUMN IF NOT EXISTS attachment_mime text,
  ADD COLUMN IF NOT EXISTS attachment_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_uploaded_by uuid;

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS tipo_linha text,
  ADD COLUMN IF NOT EXISTS complement_reason text,
  ADD COLUMN IF NOT EXISTS attendance_group_key text;

CREATE INDEX IF NOT EXISTS idx_payment_items_tipo_linha ON public.payment_items(tipo_linha);
CREATE INDEX IF NOT EXISTS idx_payment_items_attendance_group ON public.payment_items(payment_id, attendance_group_key);
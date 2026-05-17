ALTER TABLE public.payment_items ADD COLUMN IF NOT EXISTS attendance_character text;
ALTER TABLE public.payment_unmatched_items ADD COLUMN IF NOT EXISTS attendance_character text;
CREATE INDEX IF NOT EXISTS idx_payment_items_attendance_character ON public.payment_items(attendance_character);
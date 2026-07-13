ALTER TABLE public.payment_items DROP CONSTRAINT IF EXISTS payment_items_parecer_evidence_check;
ALTER TABLE public.payment_items ADD CONSTRAINT payment_items_parecer_evidence_check
  CHECK (parecer_evidence IS NULL OR parecer_evidence IN ('confirmed','not_found','no_report','unverified','not_applicable'));

ALTER TABLE public.payment_parecer_reports ADD COLUMN IF NOT EXISTS cross_summary jsonb;
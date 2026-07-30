ALTER TABLE public.payment_parecer_report_rows
  ADD COLUMN IF NOT EXISTS nr_parecer text,
  ADD COLUMN IF NOT EXISTS tempo_resposta text,
  ADD COLUMN IF NOT EXISTS hora_confiavel boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_parecer_report_rows_nr_parecer
  ON public.payment_parecer_report_rows (nr_parecer)
  WHERE nr_parecer IS NOT NULL;

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS parecer_nr text,
  ADD COLUMN IF NOT EXISTS parecer_alert text;

ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_parecer_alert_check;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_parecer_alert_check
  CHECK (parecer_alert IS NULL OR parecer_alert IN ('nao_respondido','duplicado'));

CREATE INDEX IF NOT EXISTS idx_payment_items_parecer_nr
  ON public.payment_items (parecer_nr)
  WHERE parecer_nr IS NOT NULL;
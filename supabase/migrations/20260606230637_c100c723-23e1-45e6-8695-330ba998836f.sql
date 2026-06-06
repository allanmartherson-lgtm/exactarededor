ALTER TABLE public.company_threads
  ADD COLUMN IF NOT EXISTS campaign_id uuid
    REFERENCES public.comm_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'company_threads_source_check'
  ) THEN
    ALTER TABLE public.company_threads
      ADD CONSTRAINT company_threads_source_check
      CHECK (source IS NULL OR source IN (
        'manual','campaign_reply','pendencia','lote','nf'
      ));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS company_threads_company_campaign_idx
  ON public.company_threads (company_id, campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS company_threads_unique_company_campaign
  ON public.company_threads (company_id, campaign_id)
  WHERE campaign_id IS NOT NULL;
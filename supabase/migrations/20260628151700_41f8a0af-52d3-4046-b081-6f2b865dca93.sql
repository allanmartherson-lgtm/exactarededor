
ALTER TABLE public.payout_model_rubrics
  ADD COLUMN IF NOT EXISTS convenio_slugs text[] NOT NULL DEFAULT '{}'::text[];

UPDATE public.payout_model_rubrics
  SET convenio_slugs = ARRAY[convenio_slug]
  WHERE convenio_slug IS NOT NULL
    AND (convenio_slugs IS NULL OR cardinality(convenio_slugs) = 0);

CREATE INDEX IF NOT EXISTS payout_model_rubrics_convenio_slugs_gin
  ON public.payout_model_rubrics USING gin (convenio_slugs);

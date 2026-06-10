ALTER TABLE public.glosa_batches
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'convenio';

ALTER TABLE public.glosa_batches
  ADD COLUMN IF NOT EXISTS reconciliation_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_glosa_batches_source ON public.glosa_batches(source);
CREATE INDEX IF NOT EXISTS idx_glosa_batches_reconciliation_id ON public.glosa_batches(reconciliation_id);
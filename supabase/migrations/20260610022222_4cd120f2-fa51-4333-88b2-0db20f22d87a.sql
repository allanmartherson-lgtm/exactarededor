ALTER TABLE public.glosa_items
  ADD COLUMN IF NOT EXISTS match_source text,
  ADD COLUMN IF NOT EXISTS matched_company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS match_reason text;

CREATE INDEX IF NOT EXISTS idx_glosa_items_matched_company_id ON public.glosa_items(matched_company_id);
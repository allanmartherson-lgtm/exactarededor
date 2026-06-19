-- Vincula marcações de caso especial a ajustes retroativos formais

ALTER TABLE public.special_case_marks
  ADD COLUMN IF NOT EXISTS retro_adjustment_id uuid REFERENCES public.company_financial_adjustments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retro_applied_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS retro_applied_by uuid NULL;

CREATE INDEX IF NOT EXISTS idx_special_case_marks_retro_adjustment
  ON public.special_case_marks(retro_adjustment_id) WHERE retro_adjustment_id IS NOT NULL;

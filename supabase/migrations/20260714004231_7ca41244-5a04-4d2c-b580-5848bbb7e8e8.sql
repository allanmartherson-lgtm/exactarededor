
ALTER TABLE public.company_financial_adjustments
  ADD COLUMN IF NOT EXISTS cost_center_id uuid NULL
    REFERENCES public.cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cfa_cost_center_active
  ON public.company_financial_adjustments (hospital_id, company_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL AND ativo = true;

COMMENT ON COLUMN public.company_financial_adjustments.cost_center_id IS
  'Filtro opcional: quando preenchido, o ajuste só é sugerido em lotes cujo cost_center_code resolva para este cost_center. Vazio = qualquer lote da empresa.';

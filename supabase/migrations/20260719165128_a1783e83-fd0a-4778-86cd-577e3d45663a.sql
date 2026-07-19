ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS calculation_mode TEXT NOT NULL DEFAULT 'exclusive'
    CHECK (calculation_mode IN ('exclusive','cascade'));

COMMENT ON COLUMN public.rules.calculation_mode IS
  'exclusive (padrão): cálculos precisam ter filtros disjuntos — sobreposição bloqueia salvar. cascade: cálculos são avaliados por sort_order (primeiro match vence), sobreposição é intencional.';
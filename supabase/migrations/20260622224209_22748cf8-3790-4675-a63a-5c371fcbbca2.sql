ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS payment_type_id uuid REFERENCES public.payment_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rule_calculations_payment_type_id
  ON public.rule_calculations(payment_type_id)
  WHERE payment_type_id IS NOT NULL;

COMMENT ON COLUMN public.rule_calculations.payment_type_id IS
  'Filtro de tipo de pagamento por cálculo (Parecer, Visita, etc.). NULL = vale para qualquer tipo. Substitui rules.payment_type_id.';
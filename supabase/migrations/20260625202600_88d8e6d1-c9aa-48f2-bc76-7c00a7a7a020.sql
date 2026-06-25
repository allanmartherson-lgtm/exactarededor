ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_minimo_garantido_escopo_check;

ALTER TABLE public.rules
  ADD CONSTRAINT rules_minimo_garantido_escopo_check
  CHECK (minimo_garantido_escopo IN ('medico_empresa', 'empresa'));

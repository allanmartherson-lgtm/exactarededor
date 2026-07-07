-- Valida piso: valor padrão não pode ser negativo; escopo restrito a valores conhecidos;
-- entradas de piso_por_funcao (jsonb) precisam ser objetos com "valor" numérico >= 0.

ALTER TABLE public.rule_calculations
  DROP CONSTRAINT IF EXISTS rule_calculations_piso_valor_padrao_nonneg;
ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_piso_valor_padrao_nonneg
  CHECK (piso_valor_padrao IS NULL OR piso_valor_padrao >= 0);

ALTER TABLE public.rule_calculations
  DROP CONSTRAINT IF EXISTS rule_calculations_piso_escopo_valid;
ALTER TABLE public.rule_calculations
  ADD CONSTRAINT rule_calculations_piso_escopo_valid
  CHECK (piso_escopo IS NULL OR piso_escopo IN ('por_item', 'por_atendimento'));

-- Trigger para validar cada entrada do jsonb piso_por_funcao (mutável, não cabe em CHECK).
CREATE OR REPLACE FUNCTION public.validate_piso_por_funcao()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  rec  jsonb;
  key  text;
  v    numeric;
BEGIN
  IF NEW.piso_por_funcao IS NULL THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(NEW.piso_por_funcao) <> 'object' THEN
    RAISE EXCEPTION 'piso_por_funcao deve ser um objeto JSON';
  END IF;

  FOR key, rec IN SELECT * FROM jsonb_each(NEW.piso_por_funcao) LOOP
    IF jsonb_typeof(rec) <> 'object' THEN
      RAISE EXCEPTION 'piso_por_funcao["%"] deve ser objeto', key;
    END IF;
    IF (rec ? 'valor') THEN
      BEGIN
        v := (rec->>'valor')::numeric;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'piso_por_funcao["%"].valor deve ser numérico', key;
      END;
      IF v < 0 THEN
        RAISE EXCEPTION 'piso_por_funcao["%"].valor não pode ser negativo (recebido %)', key, v;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_piso_por_funcao ON public.rule_calculations;
CREATE TRIGGER trg_validate_piso_por_funcao
BEFORE INSERT OR UPDATE OF piso_por_funcao ON public.rule_calculations
FOR EACH ROW
EXECUTE FUNCTION public.validate_piso_por_funcao();
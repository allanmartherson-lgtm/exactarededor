-- 1) Corrigir trigger de piso_por_funcao para aceitar ARRAY (formato real no banco)
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

  -- Formato canônico: ARRAY de {role, label, valor}. Também aceita OBJECT
  -- por retrocompatibilidade caso surja em imports antigos.
  IF jsonb_typeof(NEW.piso_por_funcao) = 'array' THEN
    FOR rec IN SELECT * FROM jsonb_array_elements(NEW.piso_por_funcao) LOOP
      IF jsonb_typeof(rec) <> 'object' THEN
        RAISE EXCEPTION 'piso_por_funcao: cada item deve ser objeto (recebido %)', jsonb_typeof(rec);
      END IF;
      IF (rec ? 'valor') AND rec->>'valor' IS NOT NULL AND rec->>'valor' <> '' THEN
        BEGIN
          v := (rec->>'valor')::numeric;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'piso_por_funcao: valor deve ser numérico (recebido %)', rec->>'valor';
        END;
        IF v < 0 THEN
          RAISE EXCEPTION 'piso_por_funcao: valor não pode ser negativo (recebido %)', v;
        END IF;
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(NEW.piso_por_funcao) = 'object' THEN
    FOR key, rec IN SELECT * FROM jsonb_each(NEW.piso_por_funcao) LOOP
      IF jsonb_typeof(rec) <> 'object' THEN
        RAISE EXCEPTION 'piso_por_funcao["%"] deve ser objeto', key;
      END IF;
      IF (rec ? 'valor') AND rec->>'valor' IS NOT NULL AND rec->>'valor' <> '' THEN
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
  ELSE
    RAISE EXCEPTION 'piso_por_funcao deve ser array ou objeto (recebido %)', jsonb_typeof(NEW.piso_por_funcao);
  END IF;

  RETURN NEW;
END;
$$;

-- 2) Trigger BEFORE INSERT que blinda piso_habilitado contra callers legados
-- (import IA, merge de regras, RPC via jsonb_populate_record etc.) que não
-- mandam o campo explicitamente. Sem isso, jsonb_populate_record devolve NULL
-- e o INSERT falha com "null value in column piso_habilitado".
CREATE OR REPLACE FUNCTION public.default_piso_habilitado()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.piso_habilitado IS NULL THEN
    NEW.piso_habilitado := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_piso_habilitado ON public.rule_calculations;
CREATE TRIGGER trg_default_piso_habilitado
BEFORE INSERT OR UPDATE ON public.rule_calculations
FOR EACH ROW
EXECUTE FUNCTION public.default_piso_habilitado();
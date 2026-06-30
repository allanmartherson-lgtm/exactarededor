-- D3.c.a — payout_models.payment_type_id → payment_model_id (não destrutivo)
-- Adiciona payment_model_id referenciando payment_models(id), backfill da coluna legacy,
-- e trigger de sincronia bidirecional para manter as duas colunas espelhadas até D3.c.b dropar payment_type_id.

ALTER TABLE public.payout_models
  ADD COLUMN IF NOT EXISTS payment_model_id uuid REFERENCES public.payment_models(id) ON DELETE SET NULL;

-- Backfill: payment_type_id em payout_models referenciava payment_types(id), mas a Fase B'
-- garantiu que payment_models.id == payment_types.id correspondente. Confirmamos 0 órfãos
-- na auditoria, então o copy direto é seguro.
UPDATE public.payout_models
   SET payment_model_id = payment_type_id
 WHERE payment_model_id IS NULL
   AND payment_type_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payout_models_payment_model_id_idx
  ON public.payout_models(payment_model_id);

-- Trigger de sincronia bidirecional (mesmo padrão da Fase B' para payments).
CREATE OR REPLACE FUNCTION public.sync_payout_models_type_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Se uma coluna foi setada/alterada e a outra não acompanhou, espelhar.
  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_model_id IS NULL AND NEW.payment_type_id IS NOT NULL THEN
      NEW.payment_model_id := NEW.payment_type_id;
    ELSIF NEW.payment_type_id IS NULL AND NEW.payment_model_id IS NOT NULL THEN
      NEW.payment_type_id := NEW.payment_model_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- payment_model_id é a fonte canônica em código novo
    IF NEW.payment_model_id IS DISTINCT FROM OLD.payment_model_id
       AND NEW.payment_type_id IS NOT DISTINCT FROM OLD.payment_type_id THEN
      NEW.payment_type_id := NEW.payment_model_id;
    -- fallback: código legacy ainda escreve em payment_type_id
    ELSIF NEW.payment_type_id IS DISTINCT FROM OLD.payment_type_id
          AND NEW.payment_model_id IS NOT DISTINCT FROM OLD.payment_model_id THEN
      NEW.payment_model_id := NEW.payment_type_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_payout_models_type_columns ON public.payout_models;
CREATE TRIGGER trg_sync_payout_models_type_columns
  BEFORE INSERT OR UPDATE OF payment_type_id, payment_model_id
  ON public.payout_models
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_payout_models_type_columns();
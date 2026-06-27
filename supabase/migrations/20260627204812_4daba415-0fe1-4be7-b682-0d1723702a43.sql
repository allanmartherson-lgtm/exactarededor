-- Competência por item para lotes de remessa
-- Em lotes 'remessa', cada item pode pertencer a uma competência diferente
-- (derivada da data de atendimento/execução do procedimento).

ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS item_competence date,
  ADD COLUMN IF NOT EXISTS competence_source text;

-- Fonte da competência do item: como foi determinada
ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_competence_source_check;

ALTER TABLE public.payment_items
  ADD CONSTRAINT payment_items_competence_source_check
  CHECK (competence_source IS NULL OR competence_source IN (
    'procedure_date',  -- derivado automaticamente da data do procedimento
    'payment_month',   -- herdado da competência do lote (modo produção)
    'manual',          -- definido manualmente pelo analista
    'sem_data'         -- item sem data válida — bucket de revisão
  ));

CREATE INDEX IF NOT EXISTS idx_payment_items_competence
  ON public.payment_items(payment_id, item_competence);

CREATE INDEX IF NOT EXISTS idx_payment_items_sem_competencia
  ON public.payment_items(payment_id)
  WHERE competence_source = 'sem_data';

-- Função de derivação
CREATE OR REPLACE FUNCTION public.derive_item_competence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_regime text;
  v_payment_competence date;
BEGIN
  -- Override manual nunca é tocado pelo motor
  IF NEW.competence_source = 'manual' THEN
    RETURN NEW;
  END IF;

  SELECT competence_regime, competence_month
    INTO v_regime, v_payment_competence
  FROM public.payments
  WHERE id = NEW.payment_id;

  IF v_regime = 'remessa' THEN
    IF NEW.procedure_date IS NOT NULL THEN
      NEW.item_competence := date_trunc('month', NEW.procedure_date)::date;
      NEW.competence_source := 'procedure_date';
    ELSE
      NEW.item_competence := NULL;
      NEW.competence_source := 'sem_data';
    END IF;
  ELSE
    -- Produção: competência do item segue o lote
    NEW.item_competence := v_payment_competence;
    NEW.competence_source := 'payment_month';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_items_competence ON public.payment_items;
CREATE TRIGGER trg_payment_items_competence
  BEFORE INSERT OR UPDATE OF procedure_date, payment_id ON public.payment_items
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_item_competence();

-- Backfill: popular itens existentes
UPDATE public.payment_items pi
SET
  item_competence = CASE
    WHEN p.competence_regime = 'remessa' AND pi.procedure_date IS NOT NULL
      THEN date_trunc('month', pi.procedure_date)::date
    WHEN p.competence_regime = 'remessa' AND pi.procedure_date IS NULL
      THEN NULL
    ELSE p.competence_month
  END,
  competence_source = CASE
    WHEN p.competence_regime = 'remessa' AND pi.procedure_date IS NOT NULL THEN 'procedure_date'
    WHEN p.competence_regime = 'remessa' AND pi.procedure_date IS NULL THEN 'sem_data'
    ELSE 'payment_month'
  END
FROM public.payments p
WHERE pi.payment_id = p.id
  AND pi.competence_source IS NULL;
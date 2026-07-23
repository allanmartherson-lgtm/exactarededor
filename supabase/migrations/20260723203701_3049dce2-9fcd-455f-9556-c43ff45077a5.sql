
-- 1) Backfill: itens em lotes de remessa com competence_source='payment_month'
--    mas com procedure_date válida devem ser reclassificados para 'procedure_date'
UPDATE public.payment_items pi
SET
  item_competence = date_trunc('month', pi.procedure_date)::date,
  competence_source = 'procedure_date'
FROM public.payments p
WHERE pi.payment_id = p.id
  AND p.competence_regime = 'remessa'
  AND pi.competence_source = 'payment_month'
  AND pi.procedure_date IS NOT NULL;

-- 2) Trigger: quando o regime do lote muda, re-derivar competência dos itens
CREATE OR REPLACE FUNCTION public.rederive_items_competence_on_regime_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.competence_regime IS DISTINCT FROM OLD.competence_regime THEN
    IF NEW.competence_regime = 'remessa' THEN
      -- Em remessa: itens com procedure_date passam a usar a data do procedimento
      UPDATE public.payment_items
      SET
        item_competence = date_trunc('month', procedure_date)::date,
        competence_source = 'procedure_date'
      WHERE payment_id = NEW.id
        AND procedure_date IS NOT NULL
        AND competence_source IN ('payment_month', 'sem_data');

      -- Itens sem procedure_date ficam explicitamente como sem_data
      UPDATE public.payment_items
      SET
        item_competence = NULL,
        competence_source = 'sem_data'
      WHERE payment_id = NEW.id
        AND procedure_date IS NULL
        AND competence_source = 'payment_month';

    ELSIF NEW.competence_regime = 'producao' THEN
      -- Em produção: todos os itens herdam o mês do lote
      UPDATE public.payment_items
      SET
        item_competence = date_trunc('month', COALESCE(NEW.competence_month, NEW.payment_date))::date,
        competence_source = 'payment_month'
      WHERE payment_id = NEW.id
        AND competence_source <> 'manual';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rederive_items_competence_on_regime_change ON public.payments;
CREATE TRIGGER trg_rederive_items_competence_on_regime_change
AFTER UPDATE OF competence_regime ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.rederive_items_competence_on_regime_change();

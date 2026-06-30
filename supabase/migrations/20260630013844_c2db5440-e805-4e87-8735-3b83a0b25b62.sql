-- Adiciona item_type_id em rule_calculations e mantém sync com payment_type_id
ALTER TABLE public.rule_calculations
  ADD COLUMN IF NOT EXISTS item_type_id uuid;

-- Backfill (UUIDs já alinhados pela migration anterior, então é cópia direta)
UPDATE public.rule_calculations
   SET item_type_id = payment_type_id
 WHERE item_type_id IS NULL AND payment_type_id IS NOT NULL;

-- Trigger de sincronia bidirecional, padrão Fase B'
CREATE OR REPLACE FUNCTION public.sync_rule_calculations_item_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.item_type_id IS NULL AND NEW.payment_type_id IS NOT NULL THEN
    NEW.item_type_id := NEW.payment_type_id;
  ELSIF NEW.payment_type_id IS NULL AND NEW.item_type_id IS NOT NULL THEN
    NEW.payment_type_id := NEW.item_type_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rule_calculations_sync_item_type ON public.rule_calculations;
CREATE TRIGGER rule_calculations_sync_item_type
BEFORE INSERT OR UPDATE OF item_type_id, payment_type_id
ON public.rule_calculations
FOR EACH ROW
EXECUTE FUNCTION public.sync_rule_calculations_item_type();
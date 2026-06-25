CREATE OR REPLACE FUNCTION public.enforce_pool_item_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pool_id uuid;
  v_is_participant boolean;
BEGIN
  SELECT pool_id INTO v_pool_id FROM payments WHERE id = NEW.payment_id;
  IF v_pool_id IS NOT NULL THEN
    NEW.is_pool_item := true;
    -- Em pool, o item NÃO pertence a uma PJ. Só preserva company_id
    -- quando a empresa é participante do pool; caso contrário, NULL.
    IF NEW.company_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM pool_participants
        WHERE pool_id = v_pool_id
          AND company_id = NEW.company_id
      ) INTO v_is_participant;
      IF NOT v_is_participant THEN
        NEW.company_id := NULL;
      END IF;
    END IF;
  ELSE
    NEW.is_pool_item := false;
    IF NEW.company_id IS NULL THEN
      RAISE EXCEPTION 'payment_items.company_id é obrigatório para lote que não é pool (payment_id=%)', NEW.payment_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Backfill: corrigir itens de pool já gravados com company_id de PJ não participante
UPDATE payment_items pi
SET company_id = NULL
FROM payments p
WHERE pi.payment_id = p.id
  AND p.pool_id IS NOT NULL
  AND pi.company_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pool_participants pp
    WHERE pp.pool_id = p.pool_id
      AND pp.company_id = pi.company_id
  );
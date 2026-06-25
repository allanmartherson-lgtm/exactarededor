DELETE FROM payment_company_financials pcf
USING payments p
WHERE pcf.payment_id = p.id
  AND p.pool_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pool_participants pp
    WHERE pp.pool_id = p.pool_id
      AND pp.company_id = pcf.company_id
  );

CREATE OR REPLACE FUNCTION public.enforce_pool_financials_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pool_id uuid;
BEGIN
  SELECT pool_id INTO v_pool_id FROM payments WHERE id = NEW.payment_id;
  IF v_pool_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pool_participants pp
      WHERE pp.pool_id = v_pool_id AND pp.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'Empresa % não é participante do pool % — não pode ter financeiro em lote de pool (payment_id=%)',
        NEW.company_id, v_pool_id, NEW.payment_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_pool_financials_participant ON public.payment_company_financials;
CREATE TRIGGER trg_enforce_pool_financials_participant
BEFORE INSERT OR UPDATE ON public.payment_company_financials
FOR EACH ROW EXECUTE FUNCTION public.enforce_pool_financials_participant();
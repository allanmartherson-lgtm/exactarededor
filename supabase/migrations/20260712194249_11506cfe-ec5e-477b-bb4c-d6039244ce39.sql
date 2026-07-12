
-- Função: recomputa glosas + liquido do snapshot da PJ no lote
CREATE OR REPLACE FUNCTION public.recompute_company_glosas_snapshot(
  p_payment_id uuid,
  p_company_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_glosas numeric;
BEGIN
  IF p_payment_id IS NULL OR p_company_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(valor_aplicado), 0)
    INTO v_glosas
    FROM public.glosa_payment_applications
   WHERE payment_id = p_payment_id
     AND company_id = p_company_id
     AND status NOT IN ('revertido', 'pending_manual_resolution');

  UPDATE public.payment_company_financials
     SET glosas = ROUND(v_glosas::numeric, 2),
         liquido = ROUND((bruto - debitos + creditos - v_glosas - pool + conciliacao)::numeric, 2),
         updated_at = now()
   WHERE payment_id = p_payment_id
     AND company_id = p_company_id;
END;
$$;

-- Trigger function
CREATE OR REPLACE FUNCTION public.trg_recompute_snapshot_on_gpa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_company_glosas_snapshot(OLD.payment_id, OLD.company_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_company_glosas_snapshot(NEW.payment_id, NEW.company_id);
    RETURN NEW;
  END IF;

  -- UPDATE: se PJ ou valor ou status mudou, recomputa
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
     OR NEW.valor_aplicado IS DISTINCT FROM OLD.valor_aplicado
     OR NEW.status IS DISTINCT FROM OLD.status
  THEN
    PERFORM public.recompute_company_glosas_snapshot(NEW.payment_id, NEW.company_id);
    IF (OLD.company_id, OLD.payment_id) IS DISTINCT FROM (NEW.company_id, NEW.payment_id) THEN
      PERFORM public.recompute_company_glosas_snapshot(OLD.payment_id, OLD.company_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_snapshot_on_gpa_change ON public.glosa_payment_applications;
CREATE TRIGGER trg_recompute_snapshot_on_gpa_change
AFTER INSERT OR UPDATE OR DELETE ON public.glosa_payment_applications
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_snapshot_on_gpa();

-- Backfill: recomputa todos os pares (payment_id, company_id) que têm snapshot e aplicações
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT pcf.payment_id, pcf.company_id
      FROM public.payment_company_financials pcf
     WHERE EXISTS (
       SELECT 1 FROM public.glosa_payment_applications gpa
        WHERE gpa.payment_id = pcf.payment_id
          AND gpa.company_id = pcf.company_id
     )
  LOOP
    PERFORM public.recompute_company_glosas_snapshot(r.payment_id, r.company_id);
  END LOOP;
END $$;

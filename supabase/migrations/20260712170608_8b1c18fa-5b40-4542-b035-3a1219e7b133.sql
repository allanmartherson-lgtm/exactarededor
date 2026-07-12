
-- 1) Trigger: quando glosa_debts vira 'vinculada', apaga aplicações pendentes órfãs
CREATE OR REPLACE FUNCTION public.cleanup_orphan_glosa_applications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.resolution_status = 'vinculada'
     AND NEW.company_id IS NOT NULL
     AND (OLD.resolution_status IS DISTINCT FROM NEW.resolution_status
          OR OLD.company_id IS DISTINCT FROM NEW.company_id)
  THEN
    DELETE FROM public.glosa_payment_applications
    WHERE glosa_debt_id = NEW.id
      AND status = 'pending_manual_resolution'
      AND (company_id IS DISTINCT FROM NEW.company_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_orphan_glosa_applications ON public.glosa_debts;
CREATE TRIGGER trg_cleanup_orphan_glosa_applications
AFTER UPDATE ON public.glosa_debts
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_orphan_glosa_applications();

-- 2) Limpeza retroativa: aplicações pendentes cujo débito já foi vinculado a outra PJ
DELETE FROM public.glosa_payment_applications gpa
USING public.glosa_debts gd
WHERE gpa.glosa_debt_id = gd.id
  AND gpa.status = 'pending_manual_resolution'
  AND gd.resolution_status = 'vinculada'
  AND gd.company_id IS NOT NULL
  AND gpa.company_id IS DISTINCT FROM gd.company_id;

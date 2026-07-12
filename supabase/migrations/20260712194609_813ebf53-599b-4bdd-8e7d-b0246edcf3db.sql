CREATE OR REPLACE FUNCTION public.cleanup_orphan_glosa_applications()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  IF NEW.resolution_status = 'vinculada'
     AND NEW.company_id IS NOT NULL
     AND (
       OLD.resolution_status IS DISTINCT FROM NEW.resolution_status
       OR OLD.company_id IS DISTINCT FROM NEW.company_id
     )
  THEN
    FOR r IN
      DELETE FROM public.glosa_payment_applications
      WHERE glosa_debt_id = NEW.id
        AND status = 'pending_manual_resolution'
      RETURNING payment_id, company_id
    LOOP
      PERFORM public.recompute_company_glosas_snapshot(r.payment_id, r.company_id);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_orphan_glosa_applications ON public.glosa_debts;
CREATE TRIGGER trg_cleanup_orphan_glosa_applications
AFTER UPDATE ON public.glosa_debts
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_orphan_glosa_applications();
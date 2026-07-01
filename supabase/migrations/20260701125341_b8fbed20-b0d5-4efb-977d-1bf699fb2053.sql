CREATE OR REPLACE FUNCTION public.audit_log_set_hospital()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hospital_id IS NULL THEN
    NEW.hospital_id := public.current_active_hospital();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_set_hospital ON public.audit_log;
CREATE TRIGGER trg_audit_log_set_hospital
BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_log_set_hospital();
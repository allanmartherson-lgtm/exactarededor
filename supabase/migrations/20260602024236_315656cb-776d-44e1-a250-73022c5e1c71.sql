
CREATE OR REPLACE FUNCTION public.cascade_doctor_inactive_to_portal()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.active = TRUE AND NEW.active = FALSE THEN
    UPDATE public.doctor_portal_users
       SET active = FALSE
     WHERE doctor_id = NEW.id
       AND active = TRUE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_cascade_doctor_inactive_to_portal ON public.doctors;
CREATE TRIGGER trg_cascade_doctor_inactive_to_portal
AFTER UPDATE OF active ON public.doctors
FOR EACH ROW
EXECUTE FUNCTION public.cascade_doctor_inactive_to_portal();

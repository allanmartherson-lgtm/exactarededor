CREATE OR REPLACE FUNCTION public.log_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changes jsonb := '{}'::jsonb;
BEGIN
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    changes := changes || jsonb_build_object('full_name', jsonb_build_object('from', OLD.full_name, 'to', NEW.full_name));
  END IF;
  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    changes := changes || jsonb_build_object('phone', jsonb_build_object('from', OLD.phone, 'to', NEW.phone));
  END IF;
  IF NEW.role_title IS DISTINCT FROM OLD.role_title THEN
    changes := changes || jsonb_build_object('role_title', jsonb_build_object('from', OLD.role_title, 'to', NEW.role_title));
  END IF;
  IF NEW.department IS DISTINCT FROM OLD.department THEN
    changes := changes || jsonb_build_object('department', jsonb_build_object('from', OLD.department, 'to', NEW.department));
  END IF;
  IF NEW.birth_date IS DISTINCT FROM OLD.birth_date THEN
    changes := changes || jsonb_build_object('birth_date', jsonb_build_object('from', OLD.birth_date, 'to', NEW.birth_date));
  END IF;

  IF changes <> '{}'::jsonb THEN
    INSERT INTO public.audit_log(actor_id, entity_type, entity_id, action, diff)
    VALUES (auth.uid(), 'user', NEW.id, 'profile_updated', changes);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_log_changes ON public.profiles;
CREATE TRIGGER profiles_log_changes
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.log_profile_changes();
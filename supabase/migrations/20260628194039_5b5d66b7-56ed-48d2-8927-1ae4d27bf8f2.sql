
CREATE TABLE public.specialty_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  specialty_id UUID NOT NULL,
  specialty_code TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created','renamed','activated','inactivated')),
  old_name TEXT,
  new_name TEXT,
  old_active BOOLEAN,
  new_active BOOLEAN,
  actor_id UUID,
  actor_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX specialty_audit_log_specialty_id_idx ON public.specialty_audit_log(specialty_id, created_at DESC);
CREATE INDEX specialty_audit_log_created_at_idx ON public.specialty_audit_log(created_at DESC);

GRANT SELECT ON public.specialty_audit_log TO authenticated;
GRANT ALL ON public.specialty_audit_log TO service_role;

ALTER TABLE public.specialty_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read specialty audit log"
ON public.specialty_audit_log FOR SELECT
TO authenticated USING (true);

-- Block client writes — only the trigger (security definer) writes.
CREATE POLICY "No client writes to specialty audit log"
ON public.specialty_audit_log FOR INSERT
TO authenticated WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.log_specialty_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_email TEXT;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.specialty_audit_log(specialty_id, specialty_code, action, new_name, new_active, actor_id, actor_email)
    VALUES (NEW.id, NEW.code, 'created', NEW.name, NEW.active, v_actor, v_email);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      INSERT INTO public.specialty_audit_log(specialty_id, specialty_code, action, old_name, new_name, actor_id, actor_email)
      VALUES (NEW.id, NEW.code, 'renamed', OLD.name, NEW.name, v_actor, v_email);
    END IF;
    IF NEW.active IS DISTINCT FROM OLD.active THEN
      INSERT INTO public.specialty_audit_log(specialty_id, specialty_code, action, old_active, new_active, actor_id, actor_email)
      VALUES (NEW.id, NEW.code, CASE WHEN NEW.active THEN 'activated' ELSE 'inactivated' END, OLD.active, NEW.active, v_actor, v_email);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS specialties_audit_trg ON public.specialties;
CREATE TRIGGER specialties_audit_trg
AFTER INSERT OR UPDATE ON public.specialties
FOR EACH ROW EXECUTE FUNCTION public.log_specialty_change();

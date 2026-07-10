CREATE OR REPLACE FUNCTION public.audit_doctor_companies()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_entity_id uuid;
  v_diff jsonb;
  v_company_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_entity_id := NEW.id;
    v_company_id := NEW.company_id;
    v_diff := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := CASE
      WHEN OLD.end_date IS NULL AND NEW.end_date IS NOT NULL THEN 'soft_closed'
      ELSE 'updated'
    END;
    v_entity_id := NEW.id;
    v_company_id := NEW.company_id;
    v_diff := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  ELSE
    v_action := 'deleted';
    v_entity_id := OLD.id;
    v_company_id := OLD.company_id;
    v_diff := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, company_id, diff)
  VALUES ('doctor_company', v_entity_id, v_action, auth.uid(), v_company_id, v_diff);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_doctor_companies ON public.doctor_companies;
CREATE TRIGGER trg_audit_doctor_companies
AFTER INSERT OR UPDATE OR DELETE ON public.doctor_companies
FOR EACH ROW EXECUTE FUNCTION public.audit_doctor_companies();
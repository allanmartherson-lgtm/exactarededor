
-- ============================================================
-- FASE 3.2 — Bloquear DELETE físico em tabelas críticas
-- ============================================================

CREATE OR REPLACE FUNCTION public.block_physical_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- service_role pode deletar (migrations / cleanups administrativos)
  IF current_setting('request.jwt.claim.role', true) = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'DELETE físico proibido em %.%: use encerramento controlado (end_date + end_reason ou active=false). Alterações precisam de rastro auditável.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS trg_block_delete_doctor_companies ON public.doctor_companies;
CREATE TRIGGER trg_block_delete_doctor_companies
  BEFORE DELETE ON public.doctor_companies
  FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();

DROP TRIGGER IF EXISTS trg_block_delete_doctor_hosp_over ON public.doctor_hospital_overrides;
CREATE TRIGGER trg_block_delete_doctor_hosp_over
  BEFORE DELETE ON public.doctor_hospital_overrides
  FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();

DROP TRIGGER IF EXISTS trg_block_delete_company_hosp_over ON public.company_hospital_overrides;
CREATE TRIGGER trg_block_delete_company_hosp_over
  BEFORE DELETE ON public.company_hospital_overrides
  FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();

DROP TRIGGER IF EXISTS trg_block_delete_doctor_aliases ON public.doctor_aliases;
CREATE TRIGGER trg_block_delete_doctor_aliases
  BEFORE DELETE ON public.doctor_aliases
  FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();

DROP TRIGGER IF EXISTS trg_block_delete_convenio_aliases ON public.convenio_aliases;
CREATE TRIGGER trg_block_delete_convenio_aliases
  BEFORE DELETE ON public.convenio_aliases
  FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();

DROP TRIGGER IF EXISTS trg_block_delete_sector_aliases ON public.sector_aliases;
CREATE TRIGGER trg_block_delete_sector_aliases
  BEFORE DELETE ON public.sector_aliases
  FOR EACH ROW EXECUTE FUNCTION public.block_physical_delete();

-- ============================================================
-- FASE 3.3 — Estender auditoria para aliases e overrides
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_generic_registry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_entity_id uuid;
  v_diff jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_entity_id := NEW.id;
    v_diff := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated';
    v_entity_id := NEW.id;
    v_diff := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  ELSE
    v_action := 'deleted';
    v_entity_id := OLD.id;
    v_diff := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
  VALUES (TG_TABLE_NAME, v_entity_id, v_action, auth.uid(), v_diff);

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_doctor_aliases ON public.doctor_aliases;
CREATE TRIGGER trg_audit_doctor_aliases
  AFTER INSERT OR UPDATE OR DELETE ON public.doctor_aliases
  FOR EACH ROW EXECUTE FUNCTION public.audit_generic_registry();

DROP TRIGGER IF EXISTS trg_audit_convenio_aliases ON public.convenio_aliases;
CREATE TRIGGER trg_audit_convenio_aliases
  AFTER INSERT OR UPDATE OR DELETE ON public.convenio_aliases
  FOR EACH ROW EXECUTE FUNCTION public.audit_generic_registry();

DROP TRIGGER IF EXISTS trg_audit_sector_aliases ON public.sector_aliases;
CREATE TRIGGER trg_audit_sector_aliases
  AFTER INSERT OR UPDATE OR DELETE ON public.sector_aliases
  FOR EACH ROW EXECUTE FUNCTION public.audit_generic_registry();

DROP TRIGGER IF EXISTS trg_audit_doctor_hospital_overrides ON public.doctor_hospital_overrides;
CREATE TRIGGER trg_audit_doctor_hospital_overrides
  AFTER INSERT OR UPDATE OR DELETE ON public.doctor_hospital_overrides
  FOR EACH ROW EXECUTE FUNCTION public.audit_generic_registry();

DROP TRIGGER IF EXISTS trg_audit_company_hospital_overrides ON public.company_hospital_overrides;
CREATE TRIGGER trg_audit_company_hospital_overrides
  AFTER INSERT OR UPDATE OR DELETE ON public.company_hospital_overrides
  FOR EACH ROW EXECUTE FUNCTION public.audit_generic_registry();

-- ============================================================
-- Padronizar entity_type de doctor_companies (plural)
-- ============================================================

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
  VALUES ('doctor_companies', v_entity_id, v_action, auth.uid(), v_company_id, v_diff);

  RETURN COALESCE(NEW, OLD);
END;
$$;

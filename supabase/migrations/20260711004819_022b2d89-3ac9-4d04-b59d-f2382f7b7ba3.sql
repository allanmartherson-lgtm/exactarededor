
-- 0. Ampliar entidades globais do enforce_hospital_scope
CREATE OR REPLACE FUNCTION public.enforce_hospital_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_row jsonb := to_jsonb(NEW);
  v_id uuid;
  v_map text[][] := ARRAY[
    ARRAY['payment_id','payments'],
    ARRAY['invoice_id','invoices'],
    ARRAY['pool_id','pools'],
    ARRAY['glosa_debt_id','glosa_debts'],
    ARRAY['glosa_batch_id','glosa_batches'],
    ARRAY['pendencia_id','pendencias'],
    ARRAY['rule_id','rules'],
    ARRAY['campaign_id','comm_campaigns'],
    ARRAY['thread_id','company_threads']
  ];
  i int;
  v_col text;
  v_tbl text;
  v_global_entities text[] := ARRAY[
    'doctor_companies','doctor_aliases','convenio_aliases','sector_aliases',
    'doctor_hospital_overrides','company_hospital_overrides',
    'doctors','companies',
    'user_roles','user_hospitals',
    'payout_models','payout_model_rubrics',
    'reference_tables','reference_table_items',
    'payment_types','feature_flags','sla_settings',
    'convenios','sectors','cost_centers','validation_rules'
  ];
BEGIN
  IF NEW.hospital_id IS NULL THEN
    NEW.hospital_id := public.current_active_hospital();
  END IF;
  IF NEW.hospital_id IS NULL THEN
    FOR i IN 1..array_length(v_map, 1) LOOP
      v_col := v_map[i][1]; v_tbl := v_map[i][2];
      IF v_row ? v_col AND (v_row->>v_col) IS NOT NULL THEN
        BEGIN v_id := (v_row->>v_col)::uuid; EXCEPTION WHEN OTHERS THEN v_id := NULL; END;
        IF v_id IS NOT NULL THEN
          EXECUTE format('SELECT hospital_id FROM public.%I WHERE id = $1', v_tbl)
            INTO NEW.hospital_id USING v_id;
          EXIT WHEN NEW.hospital_id IS NOT NULL;
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF NEW.hospital_id IS NULL
     AND TG_TABLE_NAME = 'audit_log'
     AND v_row ? 'entity_type'
     AND (v_row->>'entity_type') = ANY(v_global_entities) THEN
    RETURN NEW;
  END IF;
  IF NEW.hospital_id IS NULL THEN
    RAISE EXCEPTION 'hospital_id obrigatório em %.% — nenhum hospital ativo na sessão nem derivável do registro pai',
      TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_type_check;
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;

DROP POLICY IF EXISTS audit_log_insert_workflow ON public.audit_log;
CREATE POLICY audit_log_insert_workflow ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    (actor_id IS NULL OR actor_id = auth.uid())
    AND (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
         OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  );

CREATE OR REPLACE FUNCTION public.audit_generic_registry()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_source text; v_actor uuid; v_hospital uuid; v_entity_id uuid;
  v_action text; v_old jsonb; v_new jsonb;
  v_diff jsonb := '{}'::jsonb; v_key text; v_changed boolean := false;
BEGIN
  BEGIN v_source := current_setting('app.audit_source', true); EXCEPTION WHEN OTHERS THEN v_source := NULL; END;
  IF v_source IN ('app','bulk','skip') THEN RETURN COALESCE(NEW, OLD); END IF;
  BEGIN v_actor := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor := NULL; END;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_new := to_jsonb(NEW);
    v_diff := jsonb_build_object('new', v_new); v_changed := true;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated'; v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF v_key = 'updated_at' THEN CONTINUE; END IF;
      IF (v_old->v_key) IS DISTINCT FROM (v_new->v_key) THEN
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old->v_key, 'new', v_new->v_key));
        v_changed := true;
      END IF;
    END LOOP;
    IF NOT v_changed THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted'; v_old := to_jsonb(OLD);
    v_diff := jsonb_build_object('old', v_old); v_changed := true;
  END IF;

  -- entity_id: usa coluna id, ou sintetiza a partir da linha inteira (tabelas com PK composta)
  BEGIN
    v_entity_id := COALESCE(
      (COALESCE(v_new, v_old)->>'id')::uuid,
      md5(COALESCE(v_new, v_old)::text)::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_entity_id := md5(COALESCE(v_new, v_old)::text)::uuid;
  END;

  BEGIN v_hospital := (COALESCE(v_new, v_old)->>'hospital_id')::uuid;
  EXCEPTION WHEN OTHERS THEN v_hospital := NULL; END;

  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff, hospital_id)
  VALUES (TG_TABLE_NAME, v_entity_id, v_action, v_actor, v_diff, v_hospital);

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit_generic_registry falhou em % %: %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE t text;
  tables text[] := ARRAY[
    'doctors','companies','convenios','sectors','cost_centers',
    'user_roles','user_hospitals',
    'payout_models','payout_model_rubrics',
    'reference_tables','reference_table_items',
    'validation_rules','payment_types','feature_flags','sla_settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%1$s ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_generic_registry()', t);
  END LOOP;
END $$;

-- Baseline
INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff)
SELECT 'user_roles', ur.id, 'baseline_snapshot', NULL,
       jsonb_build_object('snapshot', to_jsonb(ur),
         'note', 'Marco zero da auditoria. Alterações anteriores não são rastreáveis; a partir de agora toda mudança fica registrada.')
FROM public.user_roles ur
WHERE NOT EXISTS (SELECT 1 FROM public.audit_log al WHERE al.entity_type='user_roles' AND al.entity_id=ur.id AND al.action='baseline_snapshot');

INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, diff, hospital_id)
SELECT 'user_hospitals',
       md5(to_jsonb(uh)::text)::uuid,
       'baseline_snapshot', NULL,
       jsonb_build_object('snapshot', to_jsonb(uh),
         'note', 'Marco zero da auditoria de vínculos de hospital.'),
       uh.hospital_id
FROM public.user_hospitals uh
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_log al
  WHERE al.entity_type='user_hospitals' AND al.action='baseline_snapshot'
    AND al.entity_id = md5(to_jsonb(uh)::text)::uuid
);

COMMENT ON FUNCTION public.audit_generic_registry() IS
'Auditoria genérica AFTER row. Grava diff coluna-a-coluna em audit_log.
Para evitar log duplicado quando o app já chama recordAudit(), o handler executa antes:
  SELECT set_config(''app.audit_source'', ''app'', true);
Valores: ''app'' | ''bulk'' | ''skip''.';

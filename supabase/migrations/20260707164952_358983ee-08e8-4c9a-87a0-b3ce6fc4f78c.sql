
-- 1) Amplia a função enforce_hospital_scope para derivar de mais registros pai.
CREATE OR REPLACE FUNCTION public.enforce_hospital_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
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
BEGIN
  -- 1) valor explícito manda
  IF NEW.hospital_id IS NULL THEN
    -- 2) sessão de usuário: hospital ativo no servidor
    NEW.hospital_id := public.current_active_hospital();
  END IF;

  -- 3) fallback service_role / edge functions: deriva de FK pai comum
  IF NEW.hospital_id IS NULL THEN
    FOR i IN 1..array_length(v_map, 1) LOOP
      v_col := v_map[i][1];
      v_tbl := v_map[i][2];
      IF v_row ? v_col AND (v_row->>v_col) IS NOT NULL THEN
        BEGIN
          v_id := (v_row->>v_col)::uuid;
        EXCEPTION WHEN OTHERS THEN
          v_id := NULL;
        END;
        IF v_id IS NOT NULL THEN
          EXECUTE format('SELECT hospital_id FROM public.%I WHERE id = $1', v_tbl)
            INTO NEW.hospital_id
            USING v_id;
          EXIT WHEN NEW.hospital_id IS NOT NULL;
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF NEW.hospital_id IS NULL THEN
    RAISE EXCEPTION
      'hospital_id obrigatório em %.% — nenhum hospital ativo na sessão nem derivável do registro pai',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Aplica o trigger em todas as tabelas operacionais restantes com coluna
--    hospital_id (exceto infra de vínculo e globais legítimas).
DO $$
DECLARE
  r record;
  v_skip text[] := ARRAY[
    -- infra de vínculo usuário↔hospital (nunca "escopadas por hospital ativo")
    'user_active_hospital','user_hospitals',
    'company_portal_user_hospitals','doctor_portal_user_hospitals',
    'company_hospital_overrides','doctor_hospital_overrides',
    -- cadastros globais que aceitam hospital_id NULL de propósito
    'convenios','sectors','convenio_aliases','sector_aliases',
    'cost_centers','payout_models','payout_tier_tables',
    'special_case_types','special_case_marks',
    'manual_intervention_reasons','system_parameter_overrides',
    'reference_tables','reference_table_items','reference_table_port_values',
    'sla_settings','communication_sla_settings',
    -- histórico / logs (aceitam NULL histórico; sem trigger obrigatório)
    'audit_log','access_requests','export_log',
    -- tabelas de configuração por hospital que já são NOT NULL e sem service_role writes
    -- (deixamos o trigger fora para evitar loops de auto-referência)
    'hospitals'
  ];
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t USING(table_schema, table_name)
     WHERE c.column_name = 'hospital_id'
       AND c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name <> ALL(v_skip)
       AND c.table_name NOT IN (
         SELECT tgrelid::regclass::text
           FROM pg_trigger
          WHERE tgname = 'trg_enforce_hospital_scope'
       )
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_enforce_hospital_scope
         BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.enforce_hospital_scope()',
      r.table_name
    );
    RAISE NOTICE 'trigger instalado em %', r.table_name;
  END LOOP;
END $$;

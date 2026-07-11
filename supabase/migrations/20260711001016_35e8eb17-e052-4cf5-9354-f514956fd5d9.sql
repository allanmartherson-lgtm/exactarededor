
CREATE OR REPLACE FUNCTION public.enforce_hospital_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
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
    'doctor_companies',
    'doctor_aliases',
    'convenio_aliases',
    'sector_aliases',
    'doctor_hospital_overrides',
    'company_hospital_overrides',
    'doctors',
    'companies'
  ];
BEGIN
  -- 1) valor explícito manda
  IF NEW.hospital_id IS NULL THEN
    NEW.hospital_id := public.current_active_hospital();
  END IF;

  -- 2) fallback service_role / edge functions: deriva de FK pai comum
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

  -- 3) exceção para entidades globais no audit_log
  IF NEW.hospital_id IS NULL
     AND TG_TABLE_NAME = 'audit_log'
     AND v_row ? 'entity_type'
     AND (v_row->>'entity_type') = ANY(v_global_entities) THEN
    RETURN NEW; -- permite NULL para eventos globais
  END IF;

  IF NEW.hospital_id IS NULL THEN
    RAISE EXCEPTION
      'hospital_id obrigatório em %.% — nenhum hospital ativo na sessão nem derivável do registro pai',
      TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

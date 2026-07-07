
-- =============================================================================
-- PARTE 1 — BACKFILL: todos os NULLs históricos → Hospital DF Star
-- =============================================================================
-- ID DF Star: 28dffeb5-e0d2-48fb-951b-58419d41e372

DO $$
DECLARE
  df_star uuid := '28dffeb5-e0d2-48fb-951b-58419d41e372';
  tbl text;
  tables_to_backfill text[] := ARRAY[
    -- cadastros e config globais (backfill mas mantém nullable)
    'convenios', 'sectors', 'convenio_aliases', 'sector_aliases',
    'cost_centers', 'reference_tables', 'reference_table_items', 'reference_table_port_values',
    'manual_intervention_reasons', 'special_case_types',
    'sla_settings', 'communication_sla_settings', 'sheet_column_templates', 'payout_tier_tables',
    -- operacional
    'audit_log', 'notification_queue', 'access_requests', 'export_log', 'cost_center_imports',
    'system_parameter_overrides',
    'company_adjustment_applications', 'company_attachments', 'company_financial_adjustments',
    'company_group_approvals', 'company_messages', 'company_sla_overrides', 'company_threads',
    'doctor_messages', 'doctor_notifications',
    'invoice_questions', 'invoice_question_attachments',
    'payment_assignments', 'payment_director_notifications', 'payment_job_context',
    'payment_parecer_reports', 'payment_pivot_cache', 'payment_processing_jobs',
    'payment_questions', 'payment_status_history', 'payment_unmatched_items',
    'glosa_items', 'glosa_payment_applications', 'glosa_debt_items',
    'pool_calculation_runs', 'pool_deduction_values', 'pool_deductions',
    'pool_item_claims', 'pool_participants',
    'reconciliation_items', 'reconciliation_runs',
    'ai_analysis_versions', 'ai_retry_queue',
    'special_case_marks',
    'production_validations', 'production_validation_feedbacks',
    'minimum_guarantee_applications'
  ];
  affected bigint;
BEGIN
  FOREACH tbl IN ARRAY tables_to_backfill LOOP
    EXECUTE format('UPDATE public.%I SET hospital_id = $1 WHERE hospital_id IS NULL', tbl)
      USING df_star;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected > 0 THEN
      RAISE NOTICE 'Backfill %: % linhas → DF Star', tbl, affected;
    END IF;
  END LOOP;
END $$;

-- =============================================================================
-- PARTE 2 — NOT NULL nas tabelas puramente operacionais
-- =============================================================================
-- Cadastros/configs (convenios, sectors, aliases, cost_centers, reference_*,
-- manual_intervention_reasons, special_case_types, sla_settings, sheet_column_templates,
-- payout_tier_tables) permanecem nullable — NULL = "global/compartilhado".
-- audit_log permanece nullable — pode registrar ações administrativas fora de hospital.

DO $$
DECLARE
  tbl text;
  operational_tables text[] := ARRAY[
    -- pagamentos e derivados
    'payment_assignments', 'payment_director_notifications', 'payment_job_context',
    'payment_parecer_reports', 'payment_pivot_cache', 'payment_processing_jobs',
    'payment_questions', 'payment_status_history', 'payment_unmatched_items',
    -- glosa
    'glosa_items', 'glosa_payment_applications', 'glosa_debt_items',
    -- pool
    'pool_calculation_runs', 'pool_deduction_values', 'pool_deductions',
    'pool_item_claims', 'pool_participants',
    -- conciliação
    'reconciliation_items', 'reconciliation_runs',
    -- empresa (thread/mensagem/ajuste/anexo)
    'company_adjustment_applications', 'company_attachments', 'company_financial_adjustments',
    'company_group_approvals', 'company_messages', 'company_sla_overrides', 'company_threads',
    -- médico
    'doctor_messages', 'doctor_notifications',
    -- notas fiscais / questionamentos
    'invoice_questions', 'invoice_question_attachments',
    -- IA
    'ai_analysis_versions', 'ai_retry_queue',
    -- notificações e filas
    'notification_queue',
    -- casos especiais e produção
    'special_case_marks',
    'production_validations', 'production_validation_feedbacks',
    -- garantia mínima
    'minimum_guarantee_applications',
    -- diversos operacionais
    'export_log', 'access_requests', 'cost_center_imports', 'system_parameter_overrides'
  ];
  remaining_nulls bigint;
BEGIN
  FOREACH tbl IN ARRAY operational_tables LOOP
    -- sanity check antes de aplicar NOT NULL
    EXECUTE format('SELECT count(*) FROM public.%I WHERE hospital_id IS NULL', tbl)
      INTO remaining_nulls;
    IF remaining_nulls > 0 THEN
      RAISE EXCEPTION 'Tabela %: ainda tem % NULLs após backfill — abortando NOT NULL', tbl, remaining_nulls;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN hospital_id SET NOT NULL', tbl);
    RAISE NOTICE '✅ NOT NULL aplicado: %', tbl;
  END LOOP;
END $$;

-- =============================================================================
-- PARTE 3 — Auditoria pós-migração
-- =============================================================================
DO $$
DECLARE
  still_nullable text;
  count_nullable int := 0;
BEGIN
  FOR still_nullable IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema='public' AND column_name='hospital_id' AND is_nullable='YES'
      AND table_name NOT LIKE 'v\_%' AND table_name NOT LIKE 'vw\_%' AND table_name NOT LIKE '%\_v'
    ORDER BY table_name
  LOOP
    count_nullable := count_nullable + 1;
  END LOOP;
  RAISE NOTICE 'Tabelas com hospital_id ainda nullable (esperado: só cadastros/config globais): %', count_nullable;
END $$;

-- Isolamento multi-tenant por hospital ativo (header x-active-hospital).
-- Estratégia: RESTRICTIVE policy em toda tabela hospital-escopada.
-- Quando o header está ausente (edge functions com service_role, psql, jobs)
-- a policy NÃO restringe — service_role bypassa RLS de qualquer forma e
-- nenhum endpoint público existe. Quando o header está presente (todo request
-- do app web), só rows do hospital ativo passam.

CREATE OR REPLACE FUNCTION public.current_active_hospital()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    current_setting('request.headers', true)::json->>'x-active-hospital',
    ''
  )::uuid
$$;

GRANT EXECUTE ON FUNCTION public.current_active_hospital() TO authenticated, anon, service_role;

DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    -- Pagamentos e cadeia de análise
    'payments','payment_items','payment_company_groups','payment_company_financials',
    'payment_observations','payment_questions','payment_status_history',
    'payment_assignments','payment_director_notifications','payment_item_hints',
    'payment_job_context','payment_pivot_cache','payment_processing_jobs',
    'payment_unmatched_items',
    'ai_analysis_versions','ai_retry_queue','analysis_dead_letter','analysis_telemetry',
    -- NFs e questões
    'invoices','invoice_questions','invoice_question_attachments',
    -- Glosas
    'glosa_batches','glosa_debts','glosa_debt_items','glosa_items','glosa_payment_applications',
    -- Regras e tabelas
    'rules','validation_rules','rule_calculations',
    'reference_tables','reference_table_items','reference_table_port_values',
    -- Pools
    'pools','pool_participants','pool_deductions','pool_calculation_runs',
    -- Conciliação
    'conciliation_bases','reconciliation_runs','reconciliation_items',
    'retroactive_reconciliations',
    -- Comunicação
    'company_threads','company_messages','comm_campaigns','communication_sla_settings',
    'company_adjustment_applications','company_attachments','company_financial_adjustments',
    'company_sla_overrides',
    'doctor_messages','doctor_notifications',
    -- Financeiro / governança / config por hospital
    'financial_journal','pendencias','learned_patterns','minimum_guarantee_applications',
    'sheet_column_templates','sla_settings','status_anomalies',
    'cost_centers','cost_center_imports',
    'notification_queue','export_log',
    'production_validations','production_validation_feedbacks',
    'audit_log','access_requests'
    -- NÃO entram (são vínculos N:N hospital ↔ usuário/empresa/médico):
    -- user_hospitals, company_hospital_overrides, doctor_hospital_overrides,
    -- company_portal_user_hospitals, doctor_portal_user_hospitals
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('DROP POLICY IF EXISTS active_hospital_scope ON public.%I', t);
    EXECUTE format($f$
      CREATE POLICY active_hospital_scope ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO authenticated
        USING (
          public.current_active_hospital() IS NULL
          OR hospital_id IS NULL
          OR hospital_id = public.current_active_hospital()
        )
        WITH CHECK (
          public.current_active_hospital() IS NULL
          OR hospital_id IS NULL
          OR hospital_id = public.current_active_hospital()
        )
    $f$, t);
  END LOOP;
END$$;
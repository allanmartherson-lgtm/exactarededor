
-- Helpers de portal (versões _any sem company/doctor específico)
CREATE OR REPLACE FUNCTION public.is_any_company_portal_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.company_portal_users WHERE user_id = _uid AND active) $$;

CREATE OR REPLACE FUNCTION public.is_any_doctor_portal_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.doctor_portal_users WHERE user_id = _uid AND active) $$;

CREATE OR REPLACE FUNCTION public.is_portal_user(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.is_any_company_portal_user(_uid) OR public.is_any_doctor_portal_user(_uid) $$;

CREATE OR REPLACE FUNCTION public.hospital_scope_allows(_hospital_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    auth.uid() IS NULL
    OR public.is_global_role(auth.uid())
    OR public.is_portal_user(auth.uid())
    OR _hospital_id IS NULL
    OR _hospital_id = ANY (public.user_hospital_ids(auth.uid()))
$$;

CREATE OR REPLACE FUNCTION public.state_scope_allows(_state_uf text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    auth.uid() IS NULL
    OR public.is_global_role(auth.uid())
    OR public.is_portal_user(auth.uid())
    OR _state_uf IS NULL
    OR _state_uf = ANY (public.user_state_ufs(auth.uid()))
$$;

DO $do$
DECLARE
  t text;
  op_tables text[] := ARRAY[
    'access_requests','ai_analysis_versions','analysis_dead_letter','analysis_telemetry',
    'audit_log','company_adjustment_applications','company_attachments',
    'company_financial_adjustments','company_messages','company_sla_overrides',
    'company_threads','conciliation_bases','cost_center_imports','cost_centers',
    'doctor_messages','doctor_notifications','financial_journal','glosa_batches',
    'glosa_debt_items','glosa_debts','glosa_items','glosa_payment_applications',
    'invoice_question_attachments','invoice_questions','invoices','notification_queue',
    'payment_assignments','payment_company_financials','payment_company_groups',
    'payment_director_notifications','payment_items','payment_job_context',
    'payment_observations','payment_pivot_cache','payment_processing_jobs',
    'payment_questions','payment_status_history','payment_unmatched_items','payments',
    'pendencias','pool_calculation_runs','pool_deductions','pool_participants','pools',
    'production_validation_feedbacks','production_validations','reconciliation_items',
    'reconciliation_runs','reference_table_items','reference_table_port_values',
    'reference_tables','rule_calculations','rules','sla_settings','status_anomalies',
    'validation_rules'
  ];
BEGIN
  FOREACH t IN ARRAY op_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS hospital_scope_restrictive ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY hospital_scope_restrictive ON public.%I '
      'AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.hospital_scope_allows(hospital_id)) '
      'WITH CHECK (hospital_id IS NULL OR public.hospital_scope_allows(hospital_id))',
      t
    );
  END LOOP;
END
$do$;

DO $do$
DECLARE
  t text;
  state_tables text[] := ARRAY[
    'companies','convenios','doctors','sectors',
    'convenio_aliases','doctor_aliases','sector_aliases'
  ];
BEGIN
  FOREACH t IN ARRAY state_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS state_scope_restrictive ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY state_scope_restrictive ON public.%I '
      'AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.state_scope_allows(state_uf)) '
      'WITH CHECK (state_uf IS NULL OR public.state_scope_allows(state_uf))',
      t
    );
  END LOOP;
END
$do$;

CREATE INDEX IF NOT EXISTS idx_user_hospitals_user ON public.user_hospitals(user_id);

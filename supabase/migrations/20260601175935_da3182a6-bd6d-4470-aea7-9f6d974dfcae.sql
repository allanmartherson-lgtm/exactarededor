-- Migration 2: adiciona hospital_id e state_uf em tabelas operacionais e cadastros
DO $$
DECLARE
  v_hospital_id uuid;
  v_op_tables text[] := ARRAY[
    'payments','payment_items','payment_company_groups','payment_observations',
    'payment_status_history','payment_assignments','payment_unmatched_items',
    'payment_processing_jobs','ai_analysis_versions','payment_pivot_cache',
    'payment_company_financials','payment_director_notifications','payment_job_context',
    'payment_questions',
    'invoices','invoice_questions','invoice_question_attachments',
    'reconciliation_runs','reconciliation_items','conciliation_bases',
    'glosa_batches','glosa_items','glosa_debts','glosa_debt_items','glosa_payment_applications',
    'rules','rule_calculations','validation_rules',
    'reference_tables','reference_table_items','reference_table_port_values',
    'cost_centers','cost_center_imports',
    'sla_settings','company_sla_overrides',
    'notification_queue','access_requests','audit_log',
    'pendencias','pools','pool_participants','pool_deductions','pool_calculation_runs',
    'production_validations','production_validation_feedbacks',
    'analysis_dead_letter','analysis_telemetry','status_anomalies',
    'financial_journal',
    'company_adjustment_applications','company_financial_adjustments',
    'company_messages','company_attachments','company_threads',
    'doctor_messages','doctor_notifications'
  ];
  v_registry_tables text[] := ARRAY[
    'doctors','companies','convenios','sectors',
    'doctor_aliases','convenio_aliases','sector_aliases'
  ];
  t text;
BEGIN
  SELECT id INTO v_hospital_id FROM public.hospitals WHERE slug = 'df_star';

  -- Operacionais: hospital_id nullable + backfill + index
  FOREACH t IN ARRAY v_op_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS hospital_id uuid REFERENCES public.hospitals(id)', t);
    EXECUTE format('UPDATE public.%I SET hospital_id = %L WHERE hospital_id IS NULL', t, v_hospital_id);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_hospital ON public.%I(hospital_id)', t, t);
  END LOOP;

  -- Cadastros: state_uf default 'DF'
  FOREACH t IN ARRAY v_registry_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS state_uf char(2)', t);
    EXECUTE format('UPDATE public.%I SET state_uf = %L WHERE state_uf IS NULL', t, 'DF');
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_state ON public.%I(state_uf)', t, t);
  END LOOP;
END $$;

-- Tabelas de override (estaduais com override local por hospital)
CREATE TABLE public.doctor_hospital_overrides (
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  override_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doctor_id, hospital_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_hospital_overrides TO authenticated;
GRANT ALL ON public.doctor_hospital_overrides TO service_role;
ALTER TABLE public.doctor_hospital_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Override visivel para hospital com acesso"
ON public.doctor_hospital_overrides FOR SELECT
TO authenticated
USING (public.can_access_hospital(auth.uid(), hospital_id));
CREATE POLICY "Override gerenciado por admin/diretor"
ON public.doctor_hospital_overrides FOR ALL
TO authenticated
USING (public.is_global_role(auth.uid()))
WITH CHECK (public.is_global_role(auth.uid()));
CREATE TRIGGER update_doctor_overrides_updated_at
BEFORE UPDATE ON public.doctor_hospital_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.company_hospital_overrides (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  override_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, hospital_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_hospital_overrides TO authenticated;
GRANT ALL ON public.company_hospital_overrides TO service_role;
ALTER TABLE public.company_hospital_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Override empresa visivel para hospital com acesso"
ON public.company_hospital_overrides FOR SELECT
TO authenticated
USING (public.can_access_hospital(auth.uid(), hospital_id));
CREATE POLICY "Override empresa gerenciado por admin/diretor"
ON public.company_hospital_overrides FOR ALL
TO authenticated
USING (public.is_global_role(auth.uid()))
WITH CHECK (public.is_global_role(auth.uid()));
CREATE TRIGGER update_company_overrides_updated_at
BEFORE UPDATE ON public.company_hospital_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indices auxiliares para queries pesadas
CREATE INDEX IF NOT EXISTS idx_payments_hospital_created ON public.payments(hospital_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_items_hospital ON public.payment_items(hospital_id);
CREATE INDEX IF NOT EXISTS idx_invoices_hospital_created ON public.invoices(hospital_id, created_at DESC);
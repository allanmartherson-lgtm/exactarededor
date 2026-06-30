
-- Drop redundant service_role policies (service_role bypasses RLS)
DROP POLICY IF EXISTS "Service role manages journal" ON public.financial_journal;
DROP POLICY IF EXISTS "item_types full access for service_role" ON public.item_types;
DROP POLICY IF EXISTS "payment_models full access for service_role" ON public.payment_models;

-- Replace permissive authenticated policies with explicit auth check
-- company_link_suggestions
DROP POLICY IF EXISTS "insert_company_link_suggestions" ON public.company_link_suggestions;
CREATE POLICY "insert_company_link_suggestions" ON public.company_link_suggestions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- conciliation_bases
DROP POLICY IF EXISTS "authenticated_all" ON public.conciliation_bases;
CREATE POLICY "authenticated_all" ON public.conciliation_bases
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- convenio_link_suggestions
DROP POLICY IF EXISTS "insert_convenio_link_suggestions" ON public.convenio_link_suggestions;
CREATE POLICY "insert_convenio_link_suggestions" ON public.convenio_link_suggestions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- glosa_batches
DROP POLICY IF EXISTS "authenticated_all" ON public.glosa_batches;
CREATE POLICY "authenticated_all" ON public.glosa_batches
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- glosa_debt_items
DROP POLICY IF EXISTS "authenticated_all" ON public.glosa_debt_items;
CREATE POLICY "authenticated_all" ON public.glosa_debt_items
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- glosa_debts
DROP POLICY IF EXISTS "authenticated_all" ON public.glosa_debts;
CREATE POLICY "authenticated_all" ON public.glosa_debts
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- glosa_items
DROP POLICY IF EXISTS "authenticated_all" ON public.glosa_items;
CREATE POLICY "authenticated_all" ON public.glosa_items
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- match_telemetry
DROP POLICY IF EXISTS "insert_match_telemetry" ON public.match_telemetry;
CREATE POLICY "insert_match_telemetry" ON public.match_telemetry
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- payment_parecer_report_rows
DROP POLICY IF EXISTS "auth insert parecer rows" ON public.payment_parecer_report_rows;
CREATE POLICY "auth insert parecer rows" ON public.payment_parecer_report_rows
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- payment_parecer_reports
DROP POLICY IF EXISTS "auth insert parecer reports" ON public.payment_parecer_reports;
CREATE POLICY "auth insert parecer reports" ON public.payment_parecer_reports
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth update parecer reports" ON public.payment_parecer_reports;
CREATE POLICY "auth update parecer reports" ON public.payment_parecer_reports
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- reconciliation_items
DROP POLICY IF EXISTS "auth_all_items" ON public.reconciliation_items;
CREATE POLICY "auth_all_items" ON public.reconciliation_items
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- reconciliation_runs
DROP POLICY IF EXISTS "auth_all_runs" ON public.reconciliation_runs;
CREATE POLICY "auth_all_runs" ON public.reconciliation_runs
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- sector_link_suggestions
DROP POLICY IF EXISTS "insert_sector_link_suggestions" ON public.sector_link_suggestions;
CREATE POLICY "insert_sector_link_suggestions" ON public.sector_link_suggestions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

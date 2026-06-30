
-- Helper predicate already exists: is_portal_user(uuid). Internal = NOT portal.

-- conciliation_bases
DROP POLICY IF EXISTS authenticated_all ON public.conciliation_bases;
CREATE POLICY conciliation_bases_internal_only ON public.conciliation_bases
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()));

-- glosa_debt_items
DROP POLICY IF EXISTS authenticated_all ON public.glosa_debt_items;
CREATE POLICY glosa_debt_items_internal_only ON public.glosa_debt_items
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()));

-- glosa_debts
DROP POLICY IF EXISTS authenticated_all ON public.glosa_debts;
CREATE POLICY glosa_debts_internal_only ON public.glosa_debts
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()));

-- glosa_items
DROP POLICY IF EXISTS authenticated_all ON public.glosa_items;
CREATE POLICY glosa_items_internal_only ON public.glosa_items
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()));

-- reconciliation_items
DROP POLICY IF EXISTS auth_all_items ON public.reconciliation_items;
CREATE POLICY reconciliation_items_internal_only ON public.reconciliation_items
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()));

-- reconciliation_runs
DROP POLICY IF EXISTS auth_all_runs ON public.reconciliation_runs;
CREATE POLICY reconciliation_runs_internal_only ON public.reconciliation_runs
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT is_portal_user(auth.uid()));

-- comm_campaign_recipients: hide PII snapshots from any authenticated user via column-level grants.
REVOKE SELECT (phone_snapshot, email_snapshot) ON public.comm_campaign_recipients FROM authenticated;
GRANT SELECT (phone_snapshot, email_snapshot) ON public.comm_campaign_recipients TO service_role;

-- doctors: allow doctor portal user to read own record (closes gap of internal_only blocking own access).
DROP POLICY IF EXISTS doctors_portal_self_select ON public.doctors;
CREATE POLICY doctors_portal_self_select ON public.doctors
  FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT doctor_id FROM public.doctor_portal_users
      WHERE user_id = auth.uid() AND active = true
    )
  );

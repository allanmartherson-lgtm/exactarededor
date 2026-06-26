
-- Parent: payment_parecer_reports
DROP POLICY IF EXISTS "auth read parecer reports" ON public.payment_parecer_reports;
CREATE POLICY "parecer_reports_select_scoped"
  ON public.payment_parecer_reports FOR SELECT TO authenticated
  USING (
    NOT public.is_portal_user(auth.uid())
    AND (hospital_id IS NULL OR public.hospital_scope_allows(hospital_id))
  );

CREATE POLICY "parecer_reports_hospital_restrictive"
  ON public.payment_parecer_reports AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (hospital_id IS NULL OR public.hospital_scope_allows(hospital_id))
  WITH CHECK (hospital_id IS NULL OR public.hospital_scope_allows(hospital_id));

-- Reforça as linhas também (re-aplica caso o scanner ainda veja a antiga)
DROP POLICY IF EXISTS "auth read parecer rows" ON public.payment_parecer_report_rows;

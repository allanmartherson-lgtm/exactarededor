
-- 1) doctors
DROP POLICY IF EXISTS "doctors_view_authenticated" ON public.doctors;
CREATE POLICY "doctors_view_internal_only"
  ON public.doctors FOR SELECT TO authenticated
  USING (NOT public.is_portal_user(auth.uid()));

-- 2) payment_parecer_report_rows
DROP POLICY IF EXISTS "auth read parecer rows" ON public.payment_parecer_report_rows;
CREATE POLICY "parecer_rows_select_scoped"
  ON public.payment_parecer_report_rows FOR SELECT TO authenticated
  USING (
    NOT public.is_portal_user(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.payment_parecer_reports r
      WHERE r.id = payment_parecer_report_rows.report_id
        AND (r.hospital_id IS NULL OR public.hospital_scope_allows(r.hospital_id))
    )
  );

CREATE POLICY "parecer_rows_hospital_restrictive"
  ON public.payment_parecer_report_rows AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.payment_parecer_reports r
      WHERE r.id = payment_parecer_report_rows.report_id
        AND (r.hospital_id IS NULL OR public.hospital_scope_allows(r.hospital_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.payment_parecer_reports r
      WHERE r.id = payment_parecer_report_rows.report_id
        AND (r.hospital_id IS NULL OR public.hospital_scope_allows(r.hospital_id))
    )
  );

-- 3) glosa_item_match_history
DROP POLICY IF EXISTS "gimh_select_auth" ON public.glosa_item_match_history;
CREATE POLICY "gimh_select_internal_scoped"
  ON public.glosa_item_match_history FOR SELECT TO authenticated
  USING (
    NOT public.is_portal_user(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.glosa_batches b
      WHERE b.id = glosa_item_match_history.batch_id
        AND (b.hospital_id IS NULL OR public.hospital_scope_allows(b.hospital_id))
    )
  );

CREATE POLICY "gimh_hospital_restrictive"
  ON public.glosa_item_match_history AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.glosa_batches b
      WHERE b.id = glosa_item_match_history.batch_id
        AND (b.hospital_id IS NULL OR public.hospital_scope_allows(b.hospital_id))
    )
  );

-- 4) minimum_guarantee_applications
DROP POLICY IF EXISTS "mga_insert_authenticated" ON public.minimum_guarantee_applications;
DROP POLICY IF EXISTS "mga_update_authenticated" ON public.minimum_guarantee_applications;

CREATE POLICY "mga_insert_internal_roles"
  ON public.minimum_guarantee_applications FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
  );

CREATE POLICY "mga_update_internal_roles"
  ON public.minimum_guarantee_applications FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
  );

-- 5) tuss_audit_overrides
DROP POLICY IF EXISTS "auth read tuss overrides" ON public.tuss_audit_overrides;
DROP POLICY IF EXISTS "auth write tuss overrides" ON public.tuss_audit_overrides;
DROP POLICY IF EXISTS "auth update tuss overrides" ON public.tuss_audit_overrides;
DROP POLICY IF EXISTS "auth delete tuss overrides" ON public.tuss_audit_overrides;

CREATE POLICY "tuss_overrides_select_internal"
  ON public.tuss_audit_overrides FOR SELECT TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'diretor'::app_role)
      OR public.has_role(auth.uid(), 'validador'::app_role)
      OR public.has_role(auth.uid(), 'analista'::app_role)
    )
    AND EXISTS (
      SELECT 1 FROM public.payment_items pi
      WHERE pi.id = tuss_audit_overrides.payment_item_id
        AND (pi.hospital_id IS NULL OR public.hospital_scope_allows(pi.hospital_id))
    )
  );

CREATE POLICY "tuss_overrides_insert_internal"
  ON public.tuss_audit_overrides FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'diretor'::app_role)
      OR public.has_role(auth.uid(), 'validador'::app_role)
      OR public.has_role(auth.uid(), 'analista'::app_role)
    )
    AND EXISTS (
      SELECT 1 FROM public.payment_items pi
      WHERE pi.id = tuss_audit_overrides.payment_item_id
        AND (pi.hospital_id IS NULL OR public.hospital_scope_allows(pi.hospital_id))
    )
  );

CREATE POLICY "tuss_overrides_update_internal"
  ON public.tuss_audit_overrides FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
  );

CREATE POLICY "tuss_overrides_delete_internal"
  ON public.tuss_audit_overrides FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  );

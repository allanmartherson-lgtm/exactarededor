-- 1) retroactive_reconciliations: embute escopo de hospital nas PERMISSIVE (RESTRICTIVE mantida)
ALTER POLICY retro_recon_select_hospital ON public.retroactive_reconciliations
  USING (public.hospital_scope_allows(hospital_id));
ALTER POLICY retro_recon_insert_hospital ON public.retroactive_reconciliations
  WITH CHECK (public.hospital_scope_allows(hospital_id));
ALTER POLICY retro_recon_update_hospital ON public.retroactive_reconciliations
  USING (public.hospital_scope_allows(hospital_id))
  WITH CHECK (public.hospital_scope_allows(hospital_id));
ALTER POLICY retro_recon_delete_hospital ON public.retroactive_reconciliations
  USING (public.hospital_scope_allows(hospital_id));

-- 2) reconciliation_company_mappings: helper canônico (cobre admin/diretor via is_global_role)
ALTER POLICY rcm_select_by_payment_hospital ON public.reconciliation_company_mappings
  USING (EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = reconciliation_company_mappings.payment_id
      AND public.hospital_scope_allows(p.hospital_id)
  ));
ALTER POLICY rcm_insert_by_payment_hospital ON public.reconciliation_company_mappings
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = reconciliation_company_mappings.payment_id
      AND public.hospital_scope_allows(p.hospital_id)
  ));

-- 3) payment_engine_sources
ALTER POLICY engine_sources_select_by_hospital ON public.payment_engine_sources
  USING (EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = payment_engine_sources.payment_id
      AND public.hospital_scope_allows(p.hospital_id)
  ));

-- 4) doctors_insert_pending_self: só usuários internos criam médico provisório
ALTER POLICY doctors_insert_pending_self ON public.doctors
  WITH CHECK (
    pending_admin_review = true
    AND created_by_user_id = auth.uid()
    AND NOT public.is_portal_user(auth.uid())
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'diretor'::public.app_role)
      OR public.has_role(auth.uid(), 'analista'::public.app_role)
      OR public.has_role(auth.uid(), 'validador'::public.app_role)
      OR public.has_role(auth.uid(), 'gestao_medica'::public.app_role)
    )
    AND (state_uf IS NULL OR public.state_scope_allows(state_uf::text))
  );

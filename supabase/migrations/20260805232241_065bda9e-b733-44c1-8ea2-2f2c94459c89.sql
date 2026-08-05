-- Helper: usuário pertence à equipe interna (não portal)
CREATE OR REPLACE FUNCTION public.is_internal_staff(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid
      AND ur.role IN ('admin','diretor','validador','analista','gestao_medica')
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_internal_staff(uuid) TO authenticated;

-- 1) Overrides por hospital: DELETE só para admin (segregação de ação)
CREATE POLICY "company_overrides_delete_admin_only"
ON public.company_hospital_overrides
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "doctor_overrides_delete_admin_only"
ON public.doctor_hospital_overrides
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 2) reconciliation_company_mappings: exige equipe interna
DROP POLICY IF EXISTS "rcm_select_by_payment_hospital" ON public.reconciliation_company_mappings;
DROP POLICY IF EXISTS "rcm_insert_by_payment_hospital" ON public.reconciliation_company_mappings;

CREATE POLICY "rcm_select_by_payment_hospital"
ON public.reconciliation_company_mappings
FOR SELECT
TO authenticated
USING (
  public.is_internal_staff(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = reconciliation_company_mappings.payment_id
      AND public.hospital_scope_allows(p.hospital_id)
  )
);

CREATE POLICY "rcm_insert_by_payment_hospital"
ON public.reconciliation_company_mappings
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_internal_staff(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = reconciliation_company_mappings.payment_id
      AND public.hospital_scope_allows(p.hospital_id)
  )
);

-- 3) retroactive_reconciliation_items: exige equipe interna em todas as ações
CREATE POLICY "retro_recon_items_internal_only"
ON public.retroactive_reconciliation_items
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (public.is_internal_staff(auth.uid()))
WITH CHECK (public.is_internal_staff(auth.uid()));
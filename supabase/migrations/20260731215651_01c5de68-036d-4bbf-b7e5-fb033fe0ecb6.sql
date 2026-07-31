SET lock_timeout = '15s';

DROP POLICY IF EXISTS "payment-files: upload pelo staff interno" ON storage.objects;
CREATE POLICY "payment-files: upload pelo staff interno"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment-files'
  AND split_part(name, '/', 1) = (auth.uid())::text
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'diretor'::public.app_role)
    OR public.has_role(auth.uid(), 'validador'::public.app_role)
    OR public.has_role(auth.uid(), 'analista'::public.app_role)
    OR public.has_role(auth.uid(), 'gestao_medica'::public.app_role)
  )
  AND public.storage_object_hospital_allows(bucket_id, name)
);

DROP POLICY IF EXISTS items_view_workflow ON public.payment_items;
CREATE POLICY items_view_workflow
ON public.payment_items FOR SELECT TO authenticated
USING (
  (
    (SELECT public.has_role(auth.uid(), 'analista'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'validador'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'diretor'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  AND public.hospital_scope_allows(hospital_id)
);

DROP POLICY IF EXISTS payments_view_workflow ON public.payments;
CREATE POLICY payments_view_workflow
ON public.payments FOR SELECT TO authenticated
USING (
  (
    (SELECT public.has_role(auth.uid(), 'analista'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'validador'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'diretor'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  AND public.hospital_scope_allows(hospital_id)
);

DROP POLICY IF EXISTS pcg_view_workflow ON public.payment_company_groups;
CREATE POLICY pcg_view_workflow
ON public.payment_company_groups FOR SELECT TO authenticated
USING (
  (
    (SELECT public.has_role(auth.uid(), 'analista'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'validador'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'diretor'::public.app_role))
    OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  AND public.hospital_scope_allows(hospital_id)
);

DROP POLICY IF EXISTS dc_view_internal_or_portal ON public.doctor_companies;
CREATE POLICY dc_view_internal_or_portal
ON public.doctor_companies FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'diretor'::public.app_role)
  OR public.has_role(auth.uid(), 'analista'::public.app_role)
  OR public.has_role(auth.uid(), 'validador'::public.app_role)
  OR public.has_role(auth.uid(), 'gestao_medica'::public.app_role)
  OR EXISTS (
    SELECT 1 FROM public.doctor_portal_users dpu
    WHERE dpu.user_id = auth.uid()
      AND dpu.doctor_id = doctor_companies.doctor_id
      AND dpu.active = true
      AND (
        doctor_companies.hospital_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.doctor_portal_user_hospitals dpuh
          WHERE dpuh.portal_user_id = dpu.id
            AND dpuh.hospital_id = doctor_companies.hospital_id
        )
      )
  )
  OR EXISTS (
    SELECT 1 FROM public.company_portal_users cpu
    WHERE cpu.user_id = auth.uid()
      AND cpu.company_id = doctor_companies.company_id
      AND cpu.active = true
      AND (
        doctor_companies.hospital_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.company_portal_user_hospitals cpuh
          WHERE cpuh.portal_user_id = cpu.id
            AND cpuh.hospital_id = doctor_companies.hospital_id
        )
      )
  )
);
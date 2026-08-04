DROP POLICY IF EXISTS cpu_internal_all ON public.company_portal_users;
CREATE POLICY cpu_internal_all
ON public.company_portal_users
FOR ALL
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'validador')
    OR public.has_role(auth.uid(), 'diretor')
  )
  AND NOT public.is_portal_user(auth.uid())
)
WITH CHECK (
  (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'validador')
    OR public.has_role(auth.uid(), 'diretor')
  )
  AND NOT public.is_portal_user(auth.uid())
);

DROP POLICY IF EXISTS dpu_internal_all ON public.doctor_portal_users;
CREATE POLICY dpu_internal_all
ON public.doctor_portal_users
FOR ALL
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'validador')
    OR public.has_role(auth.uid(), 'diretor')
  )
  AND NOT public.is_portal_user(auth.uid())
)
WITH CHECK (
  (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'analista')
    OR public.has_role(auth.uid(), 'validador')
    OR public.has_role(auth.uid(), 'diretor')
  )
  AND NOT public.is_portal_user(auth.uid())
);
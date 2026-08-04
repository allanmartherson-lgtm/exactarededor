-- 1) financial_journal: remover gestao_medica do acesso de leitura financeira detalhada
DROP POLICY IF EXISTS financial_journal_internal_read ON public.financial_journal;
CREATE POLICY financial_journal_internal_read
ON public.financial_journal
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'diretor'::app_role)
  OR public.has_role(auth.uid(), 'analista'::app_role)
  OR public.has_role(auth.uid(), 'validador'::app_role)
);

-- 2) company_portal_users / doctor_portal_users: exigir staff interno E não ser usuário de portal
DROP POLICY IF EXISTS cpu_internal_all ON public.company_portal_users;
CREATE POLICY cpu_internal_all
ON public.company_portal_users
FOR ALL
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  )
  AND NOT EXISTS (SELECT 1 FROM public.company_portal_users c WHERE c.user_id = auth.uid())
  AND NOT EXISTS (SELECT 1 FROM public.doctor_portal_users d WHERE d.user_id = auth.uid())
)
WITH CHECK (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  )
  AND NOT EXISTS (SELECT 1 FROM public.company_portal_users c WHERE c.user_id = auth.uid())
  AND NOT EXISTS (SELECT 1 FROM public.doctor_portal_users d WHERE d.user_id = auth.uid())
);

DROP POLICY IF EXISTS dpu_internal_all ON public.doctor_portal_users;
CREATE POLICY dpu_internal_all
ON public.doctor_portal_users
FOR ALL
TO authenticated
USING (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  )
  AND NOT EXISTS (SELECT 1 FROM public.company_portal_users c WHERE c.user_id = auth.uid())
  AND NOT EXISTS (SELECT 1 FROM public.doctor_portal_users d WHERE d.user_id = auth.uid())
)
WITH CHECK (
  (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
  )
  AND NOT EXISTS (SELECT 1 FROM public.company_portal_users c WHERE c.user_id = auth.uid())
  AND NOT EXISTS (SELECT 1 FROM public.doctor_portal_users d WHERE d.user_id = auth.uid())
);
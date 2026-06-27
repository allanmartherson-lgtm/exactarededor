
-- company_portal_users
DROP POLICY IF EXISTS "cpu_self_select" ON public.company_portal_users;
DROP POLICY IF EXISTS "cpu_internal_all" ON public.company_portal_users;

CREATE POLICY "cpu_self_select" ON public.company_portal_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "cpu_internal_all" ON public.company_portal_users
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['admin'::app_role,'analista'::app_role,'validador'::app_role,'diretor'::app_role])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['admin'::app_role,'analista'::app_role,'validador'::app_role,'diretor'::app_role])
  ));

-- doctor_portal_users
DROP POLICY IF EXISTS "dpu_self_select" ON public.doctor_portal_users;
DROP POLICY IF EXISTS "dpu_internal_all" ON public.doctor_portal_users;

CREATE POLICY "dpu_self_select" ON public.doctor_portal_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "dpu_internal_all" ON public.doctor_portal_users
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['admin'::app_role,'analista'::app_role,'validador'::app_role,'diretor'::app_role])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = auth.uid()
      AND user_roles.role = ANY (ARRAY['admin'::app_role,'analista'::app_role,'validador'::app_role,'diretor'::app_role])
  ));

-- payment_items delete
DROP POLICY IF EXISTS "items_delete_workflow" ON public.payment_items;
CREATE POLICY "items_delete_workflow" ON public.payment_items
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_items.payment_id
        AND p.created_by = auth.uid()
        AND p.status = ANY (ARRAY['rascunho'::payment_status,'em_analise_ia'::payment_status,'aguardando_validacao'::payment_status,'devolvido_analista'::payment_status,'cancelado'::payment_status])
    )
  );

-- payments delete
DROP POLICY IF EXISTS "payments_delete_workflow" ON public.payments;
CREATE POLICY "payments_delete_workflow" ON public.payments
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR (
      auth.uid() = created_by
      AND status = ANY (ARRAY['rascunho'::payment_status,'em_analise_ia'::payment_status,'aguardando_validacao'::payment_status,'devolvido_analista'::payment_status,'cancelado'::payment_status])
    )
  );

-- notification_queue: add permissive SELECT for internal workflow roles
CREATE POLICY "notification_queue_internal_select" ON public.notification_queue
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
  );

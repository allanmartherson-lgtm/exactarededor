
-- Recreate workflow policies scoped to the authenticated role
-- (previously {public}, which structurally includes anon).

-- payment_company_groups
DROP POLICY IF EXISTS pcg_manage_workflow ON public.payment_company_groups;
CREATE POLICY pcg_manage_workflow ON public.payment_company_groups
  FOR ALL TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  );

DROP POLICY IF EXISTS pcg_view_workflow ON public.payment_company_groups;
CREATE POLICY pcg_view_workflow ON public.payment_company_groups
  FOR SELECT TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  );

-- payment_items
DROP POLICY IF EXISTS items_manage_workflow ON public.payment_items;
CREATE POLICY items_manage_workflow ON public.payment_items
  FOR ALL TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  );

DROP POLICY IF EXISTS items_view_workflow ON public.payment_items;
CREATE POLICY items_view_workflow ON public.payment_items
  FOR SELECT TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  );

DROP POLICY IF EXISTS items_delete_workflow ON public.payment_items;
CREATE POLICY items_delete_workflow ON public.payment_items
  FOR DELETE TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_items.payment_id
        AND p.created_by = auth.uid()
        AND p.status = ANY (ARRAY[
          'rascunho'::payment_status,
          'em_analise_ia'::payment_status,
          'aguardando_validacao'::payment_status,
          'devolvido_analista'::payment_status,
          'cancelado'::payment_status
        ])
    )
  );

-- payments
DROP POLICY IF EXISTS payments_view_workflow ON public.payments;
CREATE POLICY payments_view_workflow ON public.payments
  FOR SELECT TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  );

DROP POLICY IF EXISTS payments_insert_analista ON public.payments;
CREATE POLICY payments_insert_analista ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (
      (SELECT has_role(auth.uid(), 'analista'::app_role))
      OR (SELECT has_role(auth.uid(), 'admin'::app_role))
      OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    )
  );

DROP POLICY IF EXISTS payments_update_workflow ON public.payments;
CREATE POLICY payments_update_workflow ON public.payments
  FOR UPDATE TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'analista'::app_role))
    OR (SELECT has_role(auth.uid(), 'validador'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (SELECT has_role(auth.uid(), 'admin'::app_role))
  );

DROP POLICY IF EXISTS payments_delete_workflow ON public.payments;
CREATE POLICY payments_delete_workflow ON public.payments
  FOR DELETE TO authenticated
  USING (
    (SELECT has_role(auth.uid(), 'admin'::app_role))
    OR (SELECT has_role(auth.uid(), 'diretor'::app_role))
    OR (
      auth.uid() = created_by
      AND status = ANY (ARRAY[
        'rascunho'::payment_status,
        'em_analise_ia'::payment_status,
        'aguardando_validacao'::payment_status,
        'devolvido_analista'::payment_status,
        'cancelado'::payment_status
      ])
    )
  );

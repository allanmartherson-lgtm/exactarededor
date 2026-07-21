
-- 1) comm_campaigns: restringir SELECT policies ao role authenticated (ao invés de public)
DROP POLICY IF EXISTS "campaigns_empresa_select_targeted" ON public.comm_campaigns;
DROP POLICY IF EXISTS "campaigns_medico_select_targeted" ON public.comm_campaigns;

CREATE POLICY "campaigns_empresa_select_targeted"
  ON public.comm_campaigns
  FOR SELECT
  TO authenticated
  USING (public.user_is_empresa_recipient_of(id));

CREATE POLICY "campaigns_medico_select_targeted"
  ON public.comm_campaigns
  FOR SELECT
  TO authenticated
  USING (public.user_is_medico_recipient_of(id));

-- 2) storage.objects payment-files: remover fallback split_part(name,'/',1)=auth.uid()
-- Leitura passa a exigir sempre que o objeto esteja referenciado em payment_source_files
-- e o usuário pertença ao hospital do lote (ou seja admin).
DROP POLICY IF EXISTS "payment-files: leitura por hospital do lote" ON storage.objects;

CREATE POLICY "payment-files: leitura por hospital do lote"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-files'
    AND (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR EXISTS (
        SELECT 1
        FROM public.payment_source_files psf
        JOIN public.payments p ON p.id = psf.payment_id
        JOIN public.user_hospitals uh
          ON uh.hospital_id = p.hospital_id
         AND uh.user_id = auth.uid()
        WHERE psf.storage_path = storage.objects.name
      )
    )
  );

-- 3) payment_group_reconciliation_overrides: registrar explicitamente ausência
-- de UPDATE/DELETE como fail-closed (imutável, audit-trail).
-- Nenhuma policy UPDATE/DELETE é criada — RLS habilitado sem policy = bloqueio total.
-- Adiciona comentário documentando a intenção para o scanner e futura manutenção.
COMMENT ON TABLE public.payment_group_reconciliation_overrides IS
  'Trilha de auditoria imutável de liberações de divergência de conciliação. '
  'Sem policies de UPDATE/DELETE por design (fail-closed): registros só podem '
  'ser inseridos por diretor/admin e nunca alterados/removidos via API.';


-- =====================================================================
-- Tarefa 1 — Persistência auditável de planilhas originais de pagamento
-- =====================================================================

-- 1) Tabela payment_source_files -------------------------------------------------
CREATE TABLE public.payment_source_files (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id          uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  storage_bucket      text NOT NULL DEFAULT 'payment-files',
  storage_path        text NOT NULL,
  original_filename   text NOT NULL,
  mime_type           text,
  size_bytes          bigint,
  sha256              text,                      -- null = legado (backfill)
  sheet_name          text,
  bucket_role         text NOT NULL DEFAULT 'outros'
    CHECK (bucket_role IN ('sat','bonus','sobreaviso','sat_geral','outros')),
  is_legacy           boolean NOT NULL DEFAULT false,
  uploaded_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Duplicação: mesmo arquivo (hash) no mesmo lote é bloqueada.
CREATE UNIQUE INDEX payment_source_files_payment_hash_uniq
  ON public.payment_source_files (payment_id, sha256)
  WHERE sha256 IS NOT NULL;

CREATE INDEX payment_source_files_payment_idx ON public.payment_source_files (payment_id);
CREATE INDEX payment_source_files_uploaded_at_idx ON public.payment_source_files (uploaded_at DESC);

-- 2) GRANTs (Data API) -----------------------------------------------------------
GRANT SELECT, INSERT ON public.payment_source_files TO authenticated;
GRANT ALL ON public.payment_source_files TO service_role;

-- 3) RLS -------------------------------------------------------------------------
ALTER TABLE public.payment_source_files ENABLE ROW LEVEL SECURITY;

-- Leitura: mesma regra do payment (usuário deve conseguir ver o lote).
-- Reaproveita hospital_id via join com payments + escopo do usuário.
CREATE POLICY "Ver arquivos originais dos lotes visíveis"
  ON public.payment_source_files
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.payments p
      WHERE p.id = payment_source_files.payment_id
        AND (
          public.has_role(auth.uid(), 'admin')
          OR (
            p.hospital_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.user_hospitals uh
              WHERE uh.user_id = auth.uid()
                AND uh.hospital_id = p.hospital_id
            )
          )
        )
    )
  );

-- Inserção: apenas quem criou o lote (durante o submit em NewPayment).
CREATE POLICY "Inserir arquivos originais no proprio lote"
  ON public.payment_source_files
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.id = payment_source_files.payment_id
        AND (p.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

-- Admin pode remover (apenas para higienização; DELETE não é fluxo normal).
CREATE POLICY "Admin remove arquivos originais"
  ON public.payment_source_files
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) RLS no bucket payment-files (storage.objects) --------------------------------
-- Fecha o buraco identificado: hoje não há policy nenhuma.
-- Escopo: user precisa ter acesso ao hospital dono do lote — resolvemos via
-- join payment_source_files -> payments.hospital_id. Fallback: dono do path.

CREATE POLICY "payment-files: leitura por hospital do lote"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR EXISTS (
        SELECT 1
        FROM public.payment_source_files psf
        JOIN public.payments p ON p.id = psf.payment_id
        JOIN public.user_hospitals uh
          ON uh.hospital_id = p.hospital_id AND uh.user_id = auth.uid()
        WHERE psf.storage_path = storage.objects.name
      )
      -- Compat: usuário dono do path (primeiro segmento = user_id) enquanto backfill roda.
      OR (split_part(storage.objects.name, '/', 1) = auth.uid()::text)
    )
  );

CREATE POLICY "payment-files: upload pelo dono"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-files'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "payment-files: admin gerencia"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'payment-files' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'payment-files' AND public.has_role(auth.uid(), 'admin'));

-- 5) Backfill dos registros existentes -------------------------------------------
-- Popula payment_source_files a partir de payments.source_file_path (35 lotes).
INSERT INTO public.payment_source_files
  (payment_id, storage_path, original_filename, uploaded_by, uploaded_at, is_legacy, bucket_role)
SELECT
  p.id,
  p.source_file_path,
  COALESCE(
    NULLIF(regexp_replace(p.source_file_path, '^.*/[0-9]+-', ''), ''),
    'arquivo-legado'
  ),
  p.created_by,
  p.created_at,
  true,
  'outros'
FROM public.payments p
WHERE p.source_file_path IS NOT NULL
ON CONFLICT DO NOTHING;

-- 6) Comentários auto-documentação ----------------------------------------------
COMMENT ON TABLE public.payment_source_files IS
  'Auditoria: preserva todas as planilhas originais enviadas por lote (SAT/Bônus/Sobreaviso), com hash SHA-256 para prova de integridade.';
COMMENT ON COLUMN public.payment_source_files.sha256 IS
  'SHA-256 do conteúdo binário (client-side). Null apenas em registros de backfill (is_legacy=true).';
COMMENT ON COLUMN public.payment_source_files.bucket_role IS
  'Papel do arquivo no lote: sat=produção, bonus=bônus, sobreaviso=sobreaviso, sat_geral=fallback, outros=uploads adicionais.';

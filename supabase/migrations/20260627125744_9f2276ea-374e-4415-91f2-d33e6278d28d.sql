
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS is_manual_entry boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_composition jsonb,
  ADD COLUMN IF NOT EXISTS manual_source_attachment_path text,
  ADD COLUMN IF NOT EXISTS manual_entered_by uuid,
  ADD COLUMN IF NOT EXISTS manual_entered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_payment_items_manual ON public.payment_items(payment_id) WHERE is_manual_entry = true;

ALTER TABLE public.payment_types
  ADD COLUMN IF NOT EXISTS calc_strategy text NOT NULL DEFAULT 'rules';

COMMENT ON COLUMN public.payment_types.calc_strategy IS 'rules = motor de regras normal; manual = sempre entra como lançamento manual (sem cálculo)';

DROP POLICY IF EXISTS "manual_sources_select_hospital" ON storage.objects;
CREATE POLICY "manual_sources_select_hospital"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-manual-sources'
    AND EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid()
        AND uh.hospital_id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "manual_sources_insert_hospital" ON storage.objects;
CREATE POLICY "manual_sources_insert_hospital"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-manual-sources'
    AND EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid()
        AND uh.hospital_id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "manual_sources_delete_hospital" ON storage.objects;
CREATE POLICY "manual_sources_delete_hospital"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'payment-manual-sources'
    AND EXISTS (
      SELECT 1 FROM public.user_hospitals uh
      WHERE uh.user_id = auth.uid()
        AND uh.hospital_id::text = (storage.foldername(name))[1]
    )
  );

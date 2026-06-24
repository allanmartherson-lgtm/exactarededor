
DROP POLICY IF EXISTS "pool_ded_att_select" ON storage.objects;
CREATE POLICY "pool_ded_att_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'pool-deduction-attachments');

DROP POLICY IF EXISTS "pool_ded_att_insert" ON storage.objects;
CREATE POLICY "pool_ded_att_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pool-deduction-attachments');

DROP POLICY IF EXISTS "pool_ded_att_update" ON storage.objects;
CREATE POLICY "pool_ded_att_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'pool-deduction-attachments');

DROP POLICY IF EXISTS "pool_ded_att_delete" ON storage.objects;
CREATE POLICY "pool_ded_att_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'pool-deduction-attachments');

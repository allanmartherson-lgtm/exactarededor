-- Restrict pool-deduction-attachments bucket to staff users with hospital access to the owning pool.
DROP POLICY IF EXISTS pool_ded_att_select ON storage.objects;
DROP POLICY IF EXISTS pool_ded_att_insert ON storage.objects;
DROP POLICY IF EXISTS pool_ded_att_update ON storage.objects;
DROP POLICY IF EXISTS pool_ded_att_delete ON storage.objects;

CREATE OR REPLACE FUNCTION public.can_access_pool_deduction_path(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.pools p
    WHERE p.id::text = split_part(_path, '/', 1)
      AND EXISTS (
        SELECT 1 FROM public.user_hospitals uh
        WHERE uh.user_id = auth.uid()
          AND uh.hospital_id = p.hospital_id
          AND uh.role IN ('admin','diretor','analista','validador')
      )
  );
$$;

CREATE POLICY pool_ded_att_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'pool-deduction-attachments'
    AND public.can_access_pool_deduction_path(name)
  );

CREATE POLICY pool_ded_att_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'pool-deduction-attachments'
    AND public.can_access_pool_deduction_path(name)
  );

CREATE POLICY pool_ded_att_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'pool-deduction-attachments'
    AND public.can_access_pool_deduction_path(name)
  )
  WITH CHECK (
    bucket_id = 'pool-deduction-attachments'
    AND public.can_access_pool_deduction_path(name)
  );

CREATE POLICY pool_ded_att_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'pool-deduction-attachments'
    AND public.can_access_pool_deduction_path(name)
  );
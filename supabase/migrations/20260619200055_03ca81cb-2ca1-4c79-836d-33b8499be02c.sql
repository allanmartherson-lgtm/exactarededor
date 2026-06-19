
-- 1) Drop unused doctor backup table (RLS disabled, sensitive data)
DROP TABLE IF EXISTS public.doctors_specialties_backup_20260518;

-- 2) payment_pivot_cache: remove permissive public-role policies (authenticated hospital_scope policies remain)
DROP POLICY IF EXISTS pivot_cache_select ON public.payment_pivot_cache;
DROP POLICY IF EXISTS pivot_cache_insert ON public.payment_pivot_cache;
DROP POLICY IF EXISTS pivot_cache_delete ON public.payment_pivot_cache;

-- 3) payment_questions: remove permissive public ALL policy
DROP POLICY IF EXISTS questions_all ON public.payment_questions;

-- 4) user_notification_settings: restrict the broad SELECT policy to service_role
DROP POLICY IF EXISTS "Service role can read all notification settings" ON public.user_notification_settings;
CREATE POLICY "Service role can read all notification settings"
  ON public.user_notification_settings
  FOR SELECT
  TO service_role
  USING (true);

-- 5) reconciliation-files storage bucket: require internal staff role
DROP POLICY IF EXISTS recon_files_read   ON storage.objects;
DROP POLICY IF EXISTS recon_files_insert ON storage.objects;
DROP POLICY IF EXISTS recon_files_update ON storage.objects;
DROP POLICY IF EXISTS recon_files_delete ON storage.objects;

CREATE POLICY recon_files_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'reconciliation-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'diretor')
      OR public.has_role(auth.uid(), 'validador')
      OR public.has_role(auth.uid(), 'analista')
    )
  );

CREATE POLICY recon_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'reconciliation-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'diretor')
      OR public.has_role(auth.uid(), 'validador')
      OR public.has_role(auth.uid(), 'analista')
    )
  );

CREATE POLICY recon_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'reconciliation-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'diretor')
      OR public.has_role(auth.uid(), 'validador')
      OR public.has_role(auth.uid(), 'analista')
    )
  );

CREATE POLICY recon_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'reconciliation-files'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'diretor')
    )
  );

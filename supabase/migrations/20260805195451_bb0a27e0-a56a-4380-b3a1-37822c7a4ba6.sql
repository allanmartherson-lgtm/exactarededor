ALTER TABLE public.doctors_import_staging
  ADD COLUMN IF NOT EXISTS hospital_id uuid DEFAULT public.current_active_hospital();

DELETE FROM public.doctors_import_staging WHERE hospital_id IS NULL;

ALTER TABLE public.doctors_import_staging
  ALTER COLUMN hospital_id SET NOT NULL;

DROP POLICY IF EXISTS staging_hospital_scope ON public.doctors_import_staging;
CREATE POLICY staging_hospital_scope
  ON public.doctors_import_staging
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (hospital_id = public.current_active_hospital())
  WITH CHECK (hospital_id = public.current_active_hospital());
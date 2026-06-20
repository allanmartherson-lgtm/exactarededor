CREATE TABLE IF NOT EXISTS public._doctor_name_fix_staging (
  cpf text PRIMARY KEY,
  full_name text NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public._doctor_name_fix_staging TO authenticated;
GRANT ALL ON public._doctor_name_fix_staging TO service_role;
ALTER TABLE public._doctor_name_fix_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging_admin_only" ON public._doctor_name_fix_staging
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
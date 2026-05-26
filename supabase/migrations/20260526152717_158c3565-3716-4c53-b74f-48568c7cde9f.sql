CREATE TABLE IF NOT EXISTS public.doctors_import_staging (
  crm text,
  uf text,
  cpf text,
  birth_date date,
  email text,
  phone text,
  vinculo text,
  specialties text[],
  active boolean,
  full_name text,
  company_name text,
  company_cnpj text
);
GRANT ALL ON public.doctors_import_staging TO service_role;
ALTER TABLE public.doctors_import_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staging_admin_only" ON public.doctors_import_staging
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
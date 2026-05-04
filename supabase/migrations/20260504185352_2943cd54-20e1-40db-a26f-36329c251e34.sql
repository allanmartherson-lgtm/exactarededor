
CREATE TABLE public.doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  crm text NOT NULL,
  crm_uf text NOT NULL,
  email text,
  phone text,
  specialties text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX doctors_crm_uf_unique ON public.doctors (crm, crm_uf);
CREATE INDEX doctors_full_name_idx ON public.doctors (lower(full_name));

ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;

CREATE POLICY doctors_view_authenticated ON public.doctors
  FOR SELECT TO authenticated USING (true);

CREATE POLICY doctors_manage_admin_diretor ON public.doctors
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER doctors_touch_updated_at
  BEFORE UPDATE ON public.doctors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.doctor_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (doctor_id, company_id)
);

CREATE INDEX doctor_companies_doctor_idx ON public.doctor_companies (doctor_id);
CREATE INDEX doctor_companies_company_idx ON public.doctor_companies (company_id);

ALTER TABLE public.doctor_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY dc_view_authenticated ON public.doctor_companies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY dc_manage_admin_diretor ON public.doctor_companies
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

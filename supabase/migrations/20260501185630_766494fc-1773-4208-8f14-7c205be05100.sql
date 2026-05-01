-- Tabela companies
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_view_authenticated ON public.companies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY companies_manage_admin_diretor ON public.companies
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER companies_touch_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_companies_name ON public.companies (lower(name));

-- Novas colunas em payment_items
ALTER TABLE public.payment_items
  ADD COLUMN company_name TEXT,
  ADD COLUMN company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN attendance_number TEXT,
  ADD COLUMN procedure_code TEXT,
  ADD COLUMN procedure_name TEXT,
  ADD COLUMN access_route TEXT,
  ADD COLUMN doctor_role TEXT,
  ADD COLUMN agreement_text TEXT,
  ADD COLUMN procedure_amount NUMERIC,
  ADD COLUMN quantity NUMERIC,
  ADD COLUMN procedure_date TIMESTAMPTZ;

CREATE INDEX idx_payment_items_company ON public.payment_items (company_id);
CREATE INDEX idx_payment_items_proc_code ON public.payment_items (procedure_code);
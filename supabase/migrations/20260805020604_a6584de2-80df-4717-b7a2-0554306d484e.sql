CREATE SEQUENCE IF NOT EXISTS public.agreement_registrations_code_seq;

CREATE TABLE public.agreement_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL DEFAULT ('ACD-' || lpad(nextval('public.agreement_registrations_code_seq')::text, 5, '0')),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id),
  company_id uuid REFERENCES public.companies(id),
  effective_from date,
  effective_to date,
  filled_by uuid REFERENCES auth.users(id),
  applies_to_all_convenios boolean NOT NULL DEFAULT true,
  convenio_exceptions uuid[] NOT NULL DEFAULT '{}',
  applies_to_all_doctors boolean NOT NULL DEFAULT true,
  doctor_exceptions uuid[] NOT NULL DEFAULT '{}',
  includes_auxiliary boolean NOT NULL DEFAULT false,
  includes_access_route boolean NOT NULL DEFAULT false,
  payment_table_base text CHECK (payment_table_base IN ('cbhpm_2018','tabela_convenio','outra')),
  payment_percentage numeric,
  has_glosa boolean NOT NULL DEFAULT false,
  glosa_conditions text,
  urgency_differentiation boolean NOT NULL DEFAULT false,
  urgency_addition_pct numeric,
  weekend_holiday_addition boolean NOT NULL DEFAULT false,
  weekend_holiday_addition_pct numeric,
  has_fixed_values boolean NOT NULL DEFAULT false,
  fixed_value_urgency_differentiation boolean NOT NULL DEFAULT false,
  exclusions_notes text,
  extra_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  free_notes text,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aguardando_supervisor','aguardando_diretor','aprovado','rejeitado','cadastrado')),
  supervisor_id uuid REFERENCES auth.users(id),
  supervisor_validated_at timestamptz,
  supervisor_notes text,
  director_id uuid REFERENCES auth.users(id),
  director_approved_at timestamptz,
  director_notes text,
  rejection_reason text,
  analyst_id uuid REFERENCES auth.users(id),
  analyst_registered_at timestamptz,
  linked_rule_id uuid REFERENCES public.rules(id),
  pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER SEQUENCE public.agreement_registrations_code_seq OWNED BY public.agreement_registrations.code;

CREATE INDEX idx_agreement_registrations_hospital ON public.agreement_registrations(hospital_id);
CREATE INDEX idx_agreement_registrations_company ON public.agreement_registrations(company_id);
CREATE INDEX idx_agreement_registrations_status ON public.agreement_registrations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agreement_registrations TO authenticated;
GRANT ALL ON public.agreement_registrations TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.agreement_registrations_code_seq TO authenticated, service_role;

ALTER TABLE public.agreement_registrations ENABLE ROW LEVEL SECURITY;

-- Mesmo padrão de rules/payout_models: duas travas restritivas de hospital + policies por papel.
CREATE POLICY "active_hospital_scope"
ON public.agreement_registrations
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (hospital_id = current_active_hospital())
WITH CHECK (hospital_id = current_active_hospital());

CREATE POLICY "hospital_scope_restrictive"
ON public.agreement_registrations
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (hospital_scope_allows(hospital_id))
WITH CHECK (hospital_scope_allows(hospital_id));

CREATE POLICY "agreement_registrations_view_internal"
ON public.agreement_registrations
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
);

CREATE POLICY "agreement_registrations_manage_admin_diretor"
ON public.agreement_registrations
FOR ALL
TO authenticated
USING (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  AND hospital_id = current_active_hospital()
  AND hospital_scope_allows(hospital_id)
)
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  AND hospital_id = current_active_hospital()
  AND hospital_scope_allows(hospital_id)
);

CREATE TRIGGER trg_agreement_registrations_updated_at
BEFORE UPDATE ON public.agreement_registrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
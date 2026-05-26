
CREATE TABLE public.payment_company_financials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  bruto numeric NOT NULL DEFAULT 0,
  debitos numeric NOT NULL DEFAULT 0,
  creditos numeric NOT NULL DEFAULT 0,
  glosas numeric NOT NULL DEFAULT 0,
  pool numeric NOT NULL DEFAULT 0,
  pool_aplicado boolean NOT NULL DEFAULT false,
  pool_preview boolean NOT NULL DEFAULT false,
  pool_detalhes jsonb NOT NULL DEFAULT '[]'::jsonb,
  conciliacao numeric NOT NULL DEFAULT 0,
  conciliacao_aplicada boolean NOT NULL DEFAULT false,
  liquido numeric NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  computed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_company_financials TO authenticated;
GRANT ALL ON public.payment_company_financials TO service_role;

ALTER TABLE public.payment_company_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pcf_view_workflow" ON public.payment_company_financials
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "pcf_manage_workflow" ON public.payment_company_financials
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'analista'::app_role)
    OR public.has_role(auth.uid(), 'validador'::app_role)
    OR public.has_role(auth.uid(), 'diretor'::app_role)
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE INDEX idx_pcf_payment ON public.payment_company_financials(payment_id);
CREATE INDEX idx_pcf_company ON public.payment_company_financials(company_id);

CREATE TRIGGER pcf_touch_updated_at BEFORE UPDATE ON public.payment_company_financials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- Fatia 1: estados das aplicações de pool/débitos/glosas no pagamento
-- Permite "aplicar automático ao abrir" sem queimar parcela; consumo só na aprovação do diretor.

-- 1) status nas aplicações de débitos da empresa
ALTER TABLE public.company_adjustment_applications
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'proposto',
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid,
  ADD COLUMN IF NOT EXISTS reverted_reason text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'auto';

ALTER TABLE public.company_adjustment_applications
  DROP CONSTRAINT IF EXISTS caa_status_check;
ALTER TABLE public.company_adjustment_applications
  ADD CONSTRAINT caa_status_check CHECK (status IN ('proposto','confirmado','revertido'));

ALTER TABLE public.company_adjustment_applications
  DROP CONSTRAINT IF EXISTS caa_source_check;
ALTER TABLE public.company_adjustment_applications
  ADD CONSTRAINT caa_source_check CHECK (source IN ('auto','manual'));

CREATE INDEX IF NOT EXISTS idx_caa_payment_company
  ON public.company_adjustment_applications(payment_id, company_id);
CREATE INDEX IF NOT EXISTS idx_caa_status ON public.company_adjustment_applications(status);

-- 2) nova tabela: aplicações de glosa por pagamento (espelha caa, mas pra glosa_debts)
CREATE TABLE IF NOT EXISTS public.glosa_payment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  company_id uuid NOT NULL,
  glosa_debt_id uuid NOT NULL,
  doctor_id uuid,
  parcela_numero int NOT NULL,
  valor_aplicado numeric NOT NULL,
  status text NOT NULL DEFAULT 'proposto' CHECK (status IN ('proposto','confirmado','revertido','pending_manual_resolution')),
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto','manual')),
  resolution_note text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  confirmed_at timestamptz,
  confirmed_by uuid,
  reverted_at timestamptz,
  reverted_by uuid,
  reverted_reason text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.glosa_payment_applications TO authenticated;
GRANT ALL ON public.glosa_payment_applications TO service_role;

ALTER TABLE public.glosa_payment_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY gpa_view ON public.glosa_payment_applications
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
      OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY gpa_insert ON public.glosa_payment_applications
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
           OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY gpa_update ON public.glosa_payment_applications
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
      OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
           OR has_role(auth.uid(),'diretor'::app_role) OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY gpa_delete ON public.glosa_payment_applications
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'validador'::app_role) OR has_role(auth.uid(),'diretor'::app_role)
      OR has_role(auth.uid(),'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_gpa_payment_company
  ON public.glosa_payment_applications(payment_id, company_id);
CREATE INDEX IF NOT EXISTS idx_gpa_glosa ON public.glosa_payment_applications(glosa_debt_id);
CREATE INDEX IF NOT EXISTS idx_gpa_status ON public.glosa_payment_applications(status);

-- 3) status na pool_calculation_runs pra mesma lógica (proposto/confirmado/revertido)
ALTER TABLE public.pool_calculation_runs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'proposto',
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_by uuid,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by uuid,
  ADD COLUMN IF NOT EXISTS reverted_reason text;

ALTER TABLE public.pool_calculation_runs
  DROP CONSTRAINT IF EXISTS pcr_status_check;
ALTER TABLE public.pool_calculation_runs
  ADD CONSTRAINT pcr_status_check CHECK (status IN ('proposto','confirmado','revertido'));

-- Histórico existente vira "confirmado" pra não criar dívida fantasma em lotes antigos
UPDATE public.company_adjustment_applications SET status = 'confirmado', confirmed_at = applied_at WHERE status = 'proposto';
UPDATE public.pool_calculation_runs SET status = 'confirmado', confirmed_at = created_at WHERE status = 'proposto';


-- =========================================================================
-- POOLS
-- =========================================================================
CREATE TABLE public.pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  descricao text,
  base_calculo text NOT NULL DEFAULT 'soma_convenio_100'
    CHECK (base_calculo IN ('soma_convenio_100','soma_expected','soma_bruto')),
  ativo boolean NOT NULL DEFAULT true,
  vigencia_inicio date,
  vigencia_fim date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pools TO authenticated;
GRANT ALL ON public.pools TO service_role;
ALTER TABLE public.pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY pools_view_workflow ON public.pools FOR SELECT TO authenticated
USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
    OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY pools_manage_admin_diretor ON public.pools FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- =========================================================================
-- POOL DEDUCTIONS
-- =========================================================================
CREATE TABLE public.pool_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  ordem integer NOT NULL DEFAULT 0,
  tipo text NOT NULL
    CHECK (tipo IN ('fixo_mensal','plantao','ajuste_credito','ajuste_debito','glosa_parcelada','valor_referencia_externa')),
  descricao text NOT NULL,
  valor numeric,                       -- usado quando fixo
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,  -- origem do ajuste/plantão
  obrigatoria boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pool_deductions_pool ON public.pool_deductions(pool_id, ordem);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_deductions TO authenticated;
GRANT ALL ON public.pool_deductions TO service_role;
ALTER TABLE public.pool_deductions ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdedu_view ON public.pool_deductions FOR SELECT TO authenticated
USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
    OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY pdedu_manage ON public.pool_deductions FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- =========================================================================
-- POOL PARTICIPANTS
-- =========================================================================
CREATE TABLE public.pool_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  participant_type text NOT NULL DEFAULT 'company'
    CHECK (participant_type IN ('company','hospital_nao_paga')),
  company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
  percentual numeric NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  ordem_exibicao integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (participant_type='company' AND company_id IS NOT NULL)
    OR (participant_type='hospital_nao_paga' AND company_id IS NULL)
  )
);
CREATE INDEX idx_pool_participants_pool ON public.pool_participants(pool_id);
CREATE INDEX idx_pool_participants_company ON public.pool_participants(company_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_participants TO authenticated;
GRANT ALL ON public.pool_participants TO service_role;
ALTER TABLE public.pool_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY ppart_view ON public.pool_participants FOR SELECT TO authenticated
USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
    OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY ppart_manage ON public.pool_participants FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- =========================================================================
-- COMPANY FINANCIAL ADJUSTMENTS
-- =========================================================================
CREATE TABLE public.company_financial_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('credito','debito','glosa_parcelada','acordo')),
  descricao text NOT NULL,
  valor_total numeric NOT NULL,
  parcelas_total integer NOT NULL DEFAULT 1 CHECK (parcelas_total >= 1),
  parcelas_pagas integer NOT NULL DEFAULT 0 CHECK (parcelas_pagas >= 0),
  data_inicio date NOT NULL DEFAULT CURRENT_DATE,
  ativo boolean NOT NULL DEFAULT true,
  origem text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cfa_company ON public.company_financial_adjustments(company_id, ativo);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_financial_adjustments TO authenticated;
GRANT ALL ON public.company_financial_adjustments TO service_role;
ALTER TABLE public.company_financial_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY cfa_view ON public.company_financial_adjustments FOR SELECT TO authenticated
USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
    OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY cfa_manage ON public.company_financial_adjustments FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- =========================================================================
-- COMPANY ADJUSTMENT APPLICATIONS (idempotência por pagamento)
-- =========================================================================
CREATE TABLE public.company_adjustment_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES public.company_financial_adjustments(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL,
  parcela_numero integer NOT NULL,
  valor_aplicado numeric NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  UNIQUE(adjustment_id, payment_id, parcela_numero)
);
CREATE INDEX idx_caa_payment ON public.company_adjustment_applications(payment_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_adjustment_applications TO authenticated;
GRANT ALL ON public.company_adjustment_applications TO service_role;
ALTER TABLE public.company_adjustment_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY caa_view ON public.company_adjustment_applications FOR SELECT TO authenticated
USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
    OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY caa_insert ON public.company_adjustment_applications FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
        OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY caa_manage ON public.company_adjustment_applications FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- =========================================================================
-- POOL CALCULATION RUNS (snapshot auditável)
-- =========================================================================
CREATE TABLE public.pool_calculation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id uuid NOT NULL REFERENCES public.pools(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL,
  base_amount numeric NOT NULL,
  deductions_applied jsonb NOT NULL DEFAULT '[]'::jsonb,
  bolo_liquido numeric NOT NULL,
  quotas jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX idx_pcr_payment ON public.pool_calculation_runs(payment_id);
CREATE INDEX idx_pcr_pool ON public.pool_calculation_runs(pool_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_calculation_runs TO authenticated;
GRANT ALL ON public.pool_calculation_runs TO service_role;
ALTER TABLE public.pool_calculation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pcr_view ON public.pool_calculation_runs FOR SELECT TO authenticated
USING (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
    OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY pcr_insert ON public.pool_calculation_runs FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'analista'::app_role) OR has_role(auth.uid(),'validador'::app_role)
        OR has_role(auth.uid(),'diretor'::app_role)  OR has_role(auth.uid(),'admin'::app_role));

CREATE POLICY pcr_manage ON public.pool_calculation_runs FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- =========================================================================
-- Triggers de updated_at
-- =========================================================================
CREATE TRIGGER trg_pools_updated BEFORE UPDATE ON public.pools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pool_deductions_updated BEFORE UPDATE ON public.pool_deductions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cfa_updated BEFORE UPDATE ON public.company_financial_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

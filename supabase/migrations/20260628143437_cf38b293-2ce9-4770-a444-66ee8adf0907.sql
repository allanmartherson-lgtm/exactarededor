
-- ============================================================
-- payout_tier_tables (tabelas de faixa reutilizáveis)
-- ============================================================
CREATE TABLE public.payout_tier_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid REFERENCES public.hospitals(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  dimension text NOT NULL CHECK (dimension IN ('atendimentos','producao_bruta','n_profissionais','outro')),
  unit text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_tier_tables TO authenticated;
GRANT ALL ON public.payout_tier_tables TO service_role;
ALTER TABLE public.payout_tier_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout_tier_tables read" ON public.payout_tier_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "payout_tier_tables admin write" ON public.payout_tier_tables FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'));

-- ============================================================
-- payout_tier_rows
-- ============================================================
CREATE TABLE public.payout_tier_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_table_id uuid NOT NULL REFERENCES public.payout_tier_tables(id) ON DELETE CASCADE,
  min_value numeric NOT NULL,
  max_value numeric,
  output_value numeric NOT NULL,
  label text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payout_tier_rows_table_idx ON public.payout_tier_rows(tier_table_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_tier_rows TO authenticated;
GRANT ALL ON public.payout_tier_rows TO service_role;
ALTER TABLE public.payout_tier_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout_tier_rows read" ON public.payout_tier_rows FOR SELECT TO authenticated USING (true);
CREATE POLICY "payout_tier_rows admin write" ON public.payout_tier_rows FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'));

-- ============================================================
-- payout_models (a "receita" por escopo)
-- ============================================================
CREATE TABLE public.payout_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  payment_type_id uuid REFERENCES public.payment_types(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  version int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);
CREATE INDEX payout_models_scope_idx ON public.payout_models(hospital_id, payment_type_id, company_id) WHERE active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_models TO authenticated;
GRANT ALL ON public.payout_models TO service_role;
ALTER TABLE public.payout_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout_models read" ON public.payout_models FOR SELECT TO authenticated USING (true);
CREATE POLICY "payout_models admin write" ON public.payout_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'));

-- ============================================================
-- payout_model_rubrics (linhas da receita)
-- ============================================================
CREATE TABLE public.payout_model_rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id uuid NOT NULL REFERENCES public.payout_models(id) ON DELETE CASCADE,
  sort_order int NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'base_producao','base_fixa',
    'desconto_pct','desconto_valor',
    'acrescimo_pct','acrescimo_valor','acrescimo_faixa',
    'retencao_pct'
  )),
  label text NOT NULL,
  incide_sobre text CHECK (incide_sobre IN ('bruto','subtotal_anterior','rubrica_especifica')),
  ref_rubric_order int,
  param_key text,
  fixed_pct numeric,
  fixed_value numeric,
  tier_table_id uuid REFERENCES public.payout_tier_tables(id) ON DELETE SET NULL,
  convenio_slug text,
  required boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model_id, sort_order)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_model_rubrics TO authenticated;
GRANT ALL ON public.payout_model_rubrics TO service_role;
ALTER TABLE public.payout_model_rubrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payout_model_rubrics read" ON public.payout_model_rubrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "payout_model_rubrics admin write" ON public.payout_model_rubrics FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'diretor'));

-- ============================================================
-- payments.payout_breakdown (memória do cálculo aplicado)
-- ============================================================
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payout_breakdown jsonb;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payout_model_id uuid REFERENCES public.payout_models(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payout_model_version int;

-- ============================================================
-- updated_at triggers (reusa função existente)
-- ============================================================
CREATE TRIGGER trg_payout_tier_tables_uat BEFORE UPDATE ON public.payout_tier_tables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_payout_tier_rows_uat BEFORE UPDATE ON public.payout_tier_rows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_payout_models_uat BEFORE UPDATE ON public.payout_models
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_payout_model_rubrics_uat BEFORE UPDATE ON public.payout_model_rubrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

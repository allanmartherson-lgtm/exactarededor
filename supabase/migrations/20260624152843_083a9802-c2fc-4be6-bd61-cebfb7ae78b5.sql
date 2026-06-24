
-- ============================================================
-- 1) pool_deductions: flag "valor variável"
-- ============================================================
ALTER TABLE public.pool_deductions
  ADD COLUMN IF NOT EXISTS valor_variavel boolean NOT NULL DEFAULT false;

-- ============================================================
-- 2) pool_deduction_values — valor por competência
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pool_deduction_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_deduction_id uuid NOT NULL REFERENCES public.pool_deductions(id) ON DELETE CASCADE,
  pool_id uuid NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  hospital_id uuid REFERENCES public.hospitals(id),
  competence_month date NOT NULL,
  valor numeric NOT NULL,
  observacao text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pool_deduction_id, competence_month),
  CHECK (date_trunc('month', competence_month) = competence_month)
);

CREATE INDEX IF NOT EXISTS idx_pdv_pool_competence
  ON public.pool_deduction_values(pool_id, competence_month);
CREATE INDEX IF NOT EXISTS idx_pdv_hospital
  ON public.pool_deduction_values(hospital_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_deduction_values TO authenticated;
GRANT ALL ON public.pool_deduction_values TO service_role;

ALTER TABLE public.pool_deduction_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pdv_view" ON public.pool_deduction_values
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "pdv_manage" ON public.pool_deduction_values
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE POLICY "pdv_active_hospital_scope" ON public.pool_deduction_values
  AS RESTRICTIVE TO authenticated
  USING ((hospital_id IS NULL) OR (hospital_id = current_active_hospital()))
  WITH CHECK ((hospital_id IS NULL) OR (hospital_id = current_active_hospital()));

CREATE POLICY "pdv_hospital_scope_restrictive" ON public.pool_deduction_values
  AS RESTRICTIVE TO authenticated
  USING (hospital_scope_allows(hospital_id))
  WITH CHECK (hospital_scope_allows(hospital_id));

CREATE TRIGGER trg_pdv_updated
  BEFORE UPDATE ON public.pool_deduction_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-herda hospital_id do pool
CREATE OR REPLACE FUNCTION public.pdv_set_hospital_from_pool()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.hospital_id IS NULL THEN
    SELECT hospital_id INTO NEW.hospital_id FROM public.pools WHERE id = NEW.pool_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_pdv_hospital_inherit
  BEFORE INSERT ON public.pool_deduction_values
  FOR EACH ROW EXECUTE FUNCTION public.pdv_set_hospital_from_pool();

-- ============================================================
-- 3) pools: escopo de produção + filtros de captura
-- ============================================================
ALTER TABLE public.pools
  ADD COLUMN IF NOT EXISTS escopo_producao text NOT NULL DEFAULT 'participantes',
  ADD COLUMN IF NOT EXISTS filtros_captura jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.pools DROP CONSTRAINT IF EXISTS pools_escopo_producao_check;
ALTER TABLE public.pools
  ADD CONSTRAINT pools_escopo_producao_check
  CHECK (escopo_producao IN ('participantes','filtrado'));

-- ============================================================
-- 4) pool_calculation_runs: auditoria de captura + invalidação
-- ============================================================
ALTER TABLE public.pool_calculation_runs
  ADD COLUMN IF NOT EXISTS captured_item_ids uuid[],
  ADD COLUMN IF NOT EXISTS competence_month date,
  ADD COLUMN IF NOT EXISTS invalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS invalidated_reason text,
  ADD COLUMN IF NOT EXISTS error_detail jsonb;

CREATE INDEX IF NOT EXISTS idx_pcr_pool_competence
  ON public.pool_calculation_runs(pool_id, competence_month);

-- ============================================================
-- 5) pool_item_claims — bloqueia mesmo item em 2 pools/competência
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pool_item_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_item_id uuid NOT NULL REFERENCES public.payment_items(id) ON DELETE CASCADE,
  pool_id uuid NOT NULL REFERENCES public.pools(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.pool_calculation_runs(id) ON DELETE SET NULL,
  competence_month date NOT NULL,
  hospital_id uuid REFERENCES public.hospitals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_item_id, competence_month)
);

CREATE INDEX IF NOT EXISTS idx_pic_pool ON public.pool_item_claims(pool_id, competence_month);
CREATE INDEX IF NOT EXISTS idx_pic_run ON public.pool_item_claims(run_id);
CREATE INDEX IF NOT EXISTS idx_pic_hospital ON public.pool_item_claims(hospital_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pool_item_claims TO authenticated;
GRANT ALL ON public.pool_item_claims TO service_role;

ALTER TABLE public.pool_item_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pic_view" ON public.pool_item_claims
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'analista'::app_role)
    OR has_role(auth.uid(), 'validador'::app_role)
    OR has_role(auth.uid(), 'diretor'::app_role)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "pic_manage" ON public.pool_item_claims
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE POLICY "pic_active_hospital_scope" ON public.pool_item_claims
  AS RESTRICTIVE TO authenticated
  USING ((hospital_id IS NULL) OR (hospital_id = current_active_hospital()))
  WITH CHECK ((hospital_id IS NULL) OR (hospital_id = current_active_hospital()));

CREATE POLICY "pic_hospital_scope_restrictive" ON public.pool_item_claims
  AS RESTRICTIVE TO authenticated
  USING (hospital_scope_allows(hospital_id))
  WITH CHECK (hospital_scope_allows(hospital_id));

-- ============================================================
-- 6) payment_items: marca item absorvido por pool
-- ============================================================
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS absorbed_by_pool_id uuid REFERENCES public.pools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS absorbed_by_run_id uuid REFERENCES public.pool_calculation_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pi_absorbed_pool ON public.payment_items(absorbed_by_pool_id);

-- ============================================================
-- 7) Trigger: alterar valor mensal invalida último run da competência
-- ============================================================
CREATE OR REPLACE FUNCTION public.pdv_invalidate_run()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pool_id uuid;
  v_competence date;
  v_dedu_desc text;
BEGIN
  v_pool_id := COALESCE(NEW.pool_id, OLD.pool_id);
  v_competence := COALESCE(NEW.competence_month, OLD.competence_month);

  SELECT descricao INTO v_dedu_desc
  FROM public.pool_deductions
  WHERE id = COALESCE(NEW.pool_deduction_id, OLD.pool_deduction_id);

  UPDATE public.pool_calculation_runs
  SET invalidated_at = now(),
      invalidated_reason = format('Dedução variável "%s" alterada para %s', COALESCE(v_dedu_desc,'—'), to_char(v_competence,'YYYY-MM'))
  WHERE pool_id = v_pool_id
    AND competence_month = v_competence
    AND invalidated_at IS NULL
    AND status <> 'revertido';

  -- audit
  INSERT INTO public.audit_log (entity_type, entity_id, action, actor_id, payload)
  VALUES (
    'pool_deduction_value',
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    auth.uid(),
    jsonb_build_object(
      'pool_id', v_pool_id,
      'competence_month', v_competence,
      'old', CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
      'new', CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
    )
  );

  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_pdv_invalidate_run
  AFTER INSERT OR UPDATE OR DELETE ON public.pool_deduction_values
  FOR EACH ROW EXECUTE FUNCTION public.pdv_invalidate_run();

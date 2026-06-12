
-- 1) Campos em rules
ALTER TABLE public.rules
  ADD COLUMN IF NOT EXISTS minimo_garantido_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS minimo_garantido_valor numeric,
  ADD COLUMN IF NOT EXISTS minimo_garantido_escopo text DEFAULT 'medico_empresa',
  ADD COLUMN IF NOT EXISTS minimo_garantido_periodicidade text DEFAULT 'competencia',
  ADD COLUMN IF NOT EXISTS minimo_garantido_base text DEFAULT 'bruto';

ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_minimo_garantido_escopo_check,
  ADD CONSTRAINT rules_minimo_garantido_escopo_check
    CHECK (minimo_garantido_escopo IN ('medico_empresa'));

ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_minimo_garantido_periodicidade_check,
  ADD CONSTRAINT rules_minimo_garantido_periodicidade_check
    CHECK (minimo_garantido_periodicidade IN ('competencia'));

ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_minimo_garantido_base_check,
  ADD CONSTRAINT rules_minimo_garantido_base_check
    CHECK (minimo_garantido_base IN ('bruto'));

ALTER TABLE public.rules
  DROP CONSTRAINT IF EXISTS rules_minimo_garantido_valor_check,
  ADD CONSTRAINT rules_minimo_garantido_valor_check
    CHECK (
      (minimo_garantido_ativo = false)
      OR (minimo_garantido_valor IS NOT NULL AND minimo_garantido_valor > 0)
    );

-- 2) item_origin em payment_items
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS item_origin text NOT NULL DEFAULT 'producao';

ALTER TABLE public.payment_items
  DROP CONSTRAINT IF EXISTS payment_items_item_origin_check,
  ADD CONSTRAINT payment_items_item_origin_check
    CHECK (item_origin IN ('producao','complemento_minimo','bonus','ajuste'));

CREATE INDEX IF NOT EXISTS idx_payment_items_origin
  ON public.payment_items(item_origin)
  WHERE item_origin <> 'producao';

-- 3) Tabela de aplicações de mínimo garantido
CREATE TABLE IF NOT EXISTS public.minimum_guarantee_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  competence_month text NOT NULL,
  hospital_id uuid REFERENCES public.hospitals(id),
  producao_calculada numeric NOT NULL DEFAULT 0,
  piso_aplicado numeric NOT NULL,
  complemento_valor numeric NOT NULL DEFAULT 0,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  synthetic_item_id uuid REFERENCES public.payment_items(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'aplicado',
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  reverted_at timestamptz,
  reverted_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mga_status_check CHECK (status IN ('aplicado','revertido'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.minimum_guarantee_applications TO authenticated;
GRANT ALL ON public.minimum_guarantee_applications TO service_role;

ALTER TABLE public.minimum_guarantee_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mga_select_authenticated"
  ON public.minimum_guarantee_applications FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "mga_insert_authenticated"
  ON public.minimum_guarantee_applications FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "mga_update_authenticated"
  ON public.minimum_guarantee_applications FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "mga_delete_admin"
  ON public.minimum_guarantee_applications FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Idempotência: 1 só aplicação "aplicado" por (regra, médico, PJ, competência)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mga_active
  ON public.minimum_guarantee_applications(rule_id, doctor_id, company_id, competence_month)
  WHERE status = 'aplicado';

CREATE INDEX IF NOT EXISTS idx_mga_competence
  ON public.minimum_guarantee_applications(competence_month, doctor_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mga_payment
  ON public.minimum_guarantee_applications(payment_id);

CREATE TRIGGER trg_mga_updated_at
  BEFORE UPDATE ON public.minimum_guarantee_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

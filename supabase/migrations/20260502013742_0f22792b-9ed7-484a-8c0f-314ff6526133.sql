-- Versionamento das análises de IA por item
CREATE TABLE public.ai_analysis_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL,
  item_id uuid NOT NULL,
  version integer NOT NULL,
  ai_status text NOT NULL,
  alerts jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  matched_rule_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_amount numeric,
  calculation_explanation text,
  gross_amount_at_time numeric,
  model text,
  triggered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version)
);

CREATE INDEX idx_ai_versions_payment ON public.ai_analysis_versions(payment_id, created_at DESC);
CREATE INDEX idx_ai_versions_item ON public.ai_analysis_versions(item_id, version DESC);

ALTER TABLE public.ai_analysis_versions ENABLE ROW LEVEL SECURITY;

-- Visível para qualquer autenticado (mesmo padrão das outras tabelas do fluxo)
CREATE POLICY "ai_versions_view_authenticated"
ON public.ai_analysis_versions FOR SELECT
TO authenticated
USING (true);

-- Insert via service role (edge function) ou usuário do fluxo
CREATE POLICY "ai_versions_insert_workflow"
ON public.ai_analysis_versions FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- Índice para acelerar timeline de observações por pagamento/item
CREATE INDEX IF NOT EXISTS idx_obs_payment_created ON public.payment_observations(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_item ON public.payment_observations(item_id) WHERE item_id IS NOT NULL;
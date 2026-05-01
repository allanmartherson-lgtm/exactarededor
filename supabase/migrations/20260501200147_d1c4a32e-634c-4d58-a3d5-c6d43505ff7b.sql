-- Tabela de centros de custo (catálogo importado da controladoria)
CREATE TABLE public.cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_p12 text NOT NULL UNIQUE,
  code_p10 text,
  code_pai text,
  level1 text,
  level2 text,
  level3 text,
  level4 text,
  level5 text,
  status text,
  active boolean NOT NULL DEFAULT true,
  imported_at timestamp with time zone NOT NULL DEFAULT now(),
  imported_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_centers_active ON public.cost_centers(active);
CREATE INDEX idx_cost_centers_p10 ON public.cost_centers(code_p10);
CREATE INDEX idx_cost_centers_pai ON public.cost_centers(code_pai);
CREATE INDEX idx_cost_centers_level5 ON public.cost_centers(level5);

ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cost_centers_view_authenticated"
  ON public.cost_centers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "cost_centers_manage_admin_diretor"
  ON public.cost_centers FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER cost_centers_touch_updated_at
  BEFORE UPDATE ON public.cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Renomear payments.cost_center -> cost_center_code (referência ao P12)
ALTER TABLE public.payments RENAME COLUMN cost_center TO cost_center_code;

-- Centro de custos por item (opcional, sobrescreve o do lote)
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS cost_center_code text;

CREATE INDEX IF NOT EXISTS idx_payments_cost_center ON public.payments(cost_center_code);
CREATE INDEX IF NOT EXISTS idx_payment_items_cost_center ON public.payment_items(cost_center_code);
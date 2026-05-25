-- 1) Nova tabela mestre de tipos de pagamento
CREATE TABLE public.payment_types (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  color text,
  sort_order integer NOT NULL DEFAULT 50,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY pt_view_authenticated ON public.payment_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY pt_manage_admin_diretor ON public.payment_types
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER trg_payment_types_touch
  BEFORE UPDATE ON public.payment_types
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Seed com os tipos existentes (preserva os códigos do enum atual)
INSERT INTO public.payment_types (code, label, description, sort_order) VALUES
  ('producao',   'Produção',   'Mês seguinte ao mês em que houve a produção',         10),
  ('plantao',    'Plantão',    'Pagamento por hora ou período',                       20),
  ('remessa',    'Remessa',    'Pago só após faturamento e envio da cobrança ao convênio', 30),
  ('valor_fixo', 'Valor fixo', 'Coordenação, assessoria e similares',                 40)
ON CONFLICT (code) DO NOTHING;

-- 3) Converte a coluna payment_type de enum para text
ALTER TABLE public.payments
  ALTER COLUMN payment_type TYPE text USING payment_type::text;

-- 4) Remove o tipo enumerado antigo (não há outras dependências)
DROP TYPE IF EXISTS public.payment_type;

-- 5) Índice auxiliar para FK lógica via code
CREATE INDEX IF NOT EXISTS idx_payments_payment_type ON public.payments (payment_type);

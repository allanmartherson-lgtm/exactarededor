-- SLA padrão por status
CREATE TABLE IF NOT EXISTS public.sla_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status public.payment_status NOT NULL UNIQUE,
  business_days integer NOT NULL DEFAULT 5,
  warning_pct integer NOT NULL DEFAULT 80,
  severity text NOT NULL DEFAULT 'alerta',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sla_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_view_authenticated" ON public.sla_settings
FOR SELECT TO authenticated USING (true);

CREATE POLICY "sla_manage_admin_diretor" ON public.sla_settings
FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

CREATE TRIGGER sla_settings_touch
BEFORE UPDATE ON public.sla_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Override por empresa
CREATE TABLE IF NOT EXISTS public.company_sla_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE,
  inherit_default boolean NOT NULL DEFAULT true,
  due_rule text NOT NULL DEFAULT 'dias_apos_aprovacao',
  -- 'dia_fixo' | 'ultimo_dia_util_mes' | 'dias_apos_fechamento' | 'dias_apos_aprovacao'
  due_day integer,
  due_offset_days integer,
  priority text NOT NULL DEFAULT 'normal', -- 'alta' | 'normal' | 'baixa'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.company_sla_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "csla_view_authenticated" ON public.company_sla_overrides
FOR SELECT TO authenticated USING (true);

CREATE POLICY "csla_manage_admin_diretor" ON public.company_sla_overrides
FOR ALL TO authenticated
USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

CREATE TRIGGER company_sla_overrides_touch
BEFORE UPDATE ON public.company_sla_overrides
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sementes mínimas para os principais status
INSERT INTO public.sla_settings (status, business_days, warning_pct, severity)
VALUES
  ('em_analise_ia', 1, 80, 'alerta'),
  ('revisao_analista', 2, 80, 'alerta'),
  ('aguardando_validacao', 3, 80, 'alerta'),
  ('devolvido_analista', 2, 80, 'alerta'),
  ('aguardando_aprovacao', 3, 80, 'alerta'),
  ('devolvido_validador', 2, 80, 'alerta'),
  ('pedido_nf_enviado', 5, 80, 'alerta'),
  ('nf_recebida', 2, 80, 'alerta'),
  ('nf_divergente', 2, 80, 'critico'),
  ('pago', 30, 90, 'informativo')
ON CONFLICT (status) DO NOTHING;

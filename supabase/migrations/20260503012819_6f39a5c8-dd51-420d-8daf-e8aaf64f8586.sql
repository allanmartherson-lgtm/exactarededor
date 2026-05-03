-- Validation rules system (deterministic, no AI)

-- Assistance groups (auxiliary table)
CREATE TABLE public.assistance_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  specialties text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.assistance_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ag_view_authenticated" ON public.assistance_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ag_manage_admin_diretor" ON public.assistance_groups
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER trg_ag_updated_at
  BEFORE UPDATE ON public.assistance_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enums for validation rules
CREATE TYPE public.validation_severity AS ENUM ('informativo', 'alerta', 'alerta_forte', 'bloquear');
CREATE TYPE public.validation_action AS ENUM ('informar', 'alerta', 'alerta_forte', 'bloquear');
CREATE TYPE public.validation_kind AS ENUM (
  'duplicidade_exata',
  'duplicidade_atendimento',
  'sobreposicao_assistencial',
  'codigo_sem_dobra',
  'codigo_nao_remuneravel',
  'item_em_pacote',
  'particular_sem_excecao'
);

-- Main validation rules table
CREATE TABLE public.validation_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  severity public.validation_severity NOT NULL DEFAULT 'alerta',
  kind public.validation_kind NOT NULL,
  action public.validation_action NOT NULL DEFAULT 'alerta',
  -- scope
  scope_global boolean NOT NULL DEFAULT true,
  sectors text[] NOT NULL DEFAULT '{}',
  payment_types text[] NOT NULL DEFAULT '{}',
  company_ids uuid[] NOT NULL DEFAULT '{}',
  doctors jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- dynamic params
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- behavior
  require_justification boolean NOT NULL DEFAULT false,
  allows_authorized_exception boolean NOT NULL DEFAULT false,
  assistance_group_id uuid REFERENCES public.assistance_groups(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.validation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vr_view_authenticated" ON public.validation_rules
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "vr_manage_admin_diretor" ON public.validation_rules
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER trg_vr_updated_at
  BEFORE UPDATE ON public.validation_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_vr_active_kind ON public.validation_rules(active, kind);

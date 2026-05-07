-- Tabela de grupos de validadores
CREATE TABLE public.validator_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.validator_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY vg_view_authenticated ON public.validator_groups
  FOR SELECT TO authenticated USING (true);

CREATE POLICY vg_manage_admin_diretor ON public.validator_groups
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE TRIGGER trg_vg_updated_at
  BEFORE UPDATE ON public.validator_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Membros dos grupos de validadores
CREATE TABLE public.validator_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.validator_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

ALTER TABLE public.validator_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY vgm_view_authenticated ON public.validator_group_members
  FOR SELECT TO authenticated USING (true);

CREATE POLICY vgm_manage_admin_diretor ON public.validator_group_members
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role));

CREATE INDEX idx_vgm_user ON public.validator_group_members(user_id);
CREATE INDEX idx_vgm_group ON public.validator_group_members(group_id);

-- Função auxiliar para checagem sem recursão
CREATE OR REPLACE FUNCTION public.is_in_validator_group(_user_id uuid, _group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.validator_group_members
    WHERE user_id = _user_id AND group_id = _group_id
  )
$$;

-- Atribuição em payment_company_groups
ALTER TABLE public.payment_company_groups
  ADD COLUMN assigned_validator_id uuid,
  ADD COLUMN assigned_validator_group_id uuid REFERENCES public.validator_groups(id) ON DELETE SET NULL,
  ADD CONSTRAINT pcg_assignment_xor CHECK (
    NOT (assigned_validator_id IS NOT NULL AND assigned_validator_group_id IS NOT NULL)
  );

CREATE INDEX idx_pcg_assigned_validator ON public.payment_company_groups(assigned_validator_id);
CREATE INDEX idx_pcg_assigned_validator_group ON public.payment_company_groups(assigned_validator_group_id);

-- =====================================================================
-- SYSTEM RELEASES — versionamento do Exacta
-- =====================================================================
CREATE TABLE public.system_releases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  changelog TEXT NOT NULL,
  release_type TEXT NOT NULL DEFAULT 'minor' CHECK (release_type IN ('major','minor','patch','hotfix')),
  is_current BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  released_by UUID,
  released_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_releases TO authenticated;
GRANT ALL ON public.system_releases TO service_role;

ALTER TABLE public.system_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sr_view_published" ON public.system_releases
  FOR SELECT TO authenticated
  USING (published = true OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

CREATE POLICY "sr_manage_admin_diretor" ON public.system_releases
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- Garante que só uma release seja "is_current = true"
CREATE UNIQUE INDEX uniq_system_releases_current ON public.system_releases (is_current) WHERE is_current = true;

-- =====================================================================
-- FEATURE FLAGS
-- =====================================================================
CREATE TABLE public.feature_flags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  rollout_pct INTEGER NOT NULL DEFAULT 100 CHECK (rollout_pct BETWEEN 0 AND 100),
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ff_view_authenticated" ON public.feature_flags
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ff_manage_admin_diretor" ON public.feature_flags
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- Função: checa se feature está habilitada para um usuário
CREATE OR REPLACE FUNCTION public.is_feature_enabled(_key TEXT, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flag RECORD;
  user_role_match BOOLEAN := false;
  hash_pct INTEGER;
BEGIN
  SELECT * INTO flag FROM public.feature_flags WHERE key = _key;
  IF NOT FOUND OR flag.enabled = false THEN RETURN false; END IF;

  -- Se há roles restritas, usuário precisa ter ao menos uma
  IF array_length(flag.allowed_roles, 1) IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = _user_id AND ur.role::text = ANY(flag.allowed_roles)
    ) INTO user_role_match;
    IF NOT user_role_match THEN RETURN false; END IF;
  END IF;

  -- Rollout percentual determinístico por user_id
  IF flag.rollout_pct >= 100 THEN RETURN true; END IF;
  IF flag.rollout_pct <= 0 THEN RETURN false; END IF;
  hash_pct := (abs(hashtext(_user_id::text || _key)) % 100);
  RETURN hash_pct < flag.rollout_pct;
END;
$$;

-- =====================================================================
-- SYSTEM ANNOUNCEMENTS — banner global
-- =====================================================================
CREATE TABLE public.system_announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical','success')),
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  dismissible BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.system_announcements TO authenticated;
GRANT ALL ON public.system_announcements TO service_role;

ALTER TABLE public.system_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sa_view_active" ON public.system_announcements
  FOR SELECT TO authenticated
  USING (active = true OR has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

CREATE POLICY "sa_manage_admin_diretor" ON public.system_announcements
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'diretor'::app_role));

-- Triggers de updated_at (reusa update_updated_at_column se existir)
CREATE TRIGGER trg_system_releases_updated BEFORE UPDATE ON public.system_releases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_feature_flags_updated BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_system_announcements_updated BEFORE UPDATE ON public.system_announcements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Release inicial (1.0.0) marcada como atual
INSERT INTO public.system_releases (version, title, changelog, release_type, is_current, published)
VALUES (
  '1.0.0',
  'Exacta — Release inicial',
  E'## 🚀 Lançamento do Exacta\n\n- Motor de regras de pagamento médico\n- Análise IA por item com explicação contextual\n- Fluxo completo: análise → validação → aprovação → NF → conciliação\n- Gestão de glosas por médico/PJ com aplicação em pagamentos\n- Pools de distribuição com simulador\n- Portal da empresa e do médico (projetos integrados)\n- Versionamento e controle de releases\n- Feature flags para rollout controlado',
  'major',
  true,
  true
);

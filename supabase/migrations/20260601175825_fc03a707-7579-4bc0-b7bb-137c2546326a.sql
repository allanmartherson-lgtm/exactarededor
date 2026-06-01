-- Migration 1: Multi-tenant foundation
-- Cria hospitals + user_hospitals, seeda DF Star, vincula usuarios existentes

CREATE TABLE public.hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  state_uf char(2) NOT NULL,
  cnpj text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hospitals TO authenticated;
GRANT ALL ON public.hospitals TO service_role;

ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hospitals readable by authenticated"
ON public.hospitals FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Hospitals manageable by admin"
ON public.hospitals FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_hospitals_updated_at
BEFORE UPDATE ON public.hospitals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed DF Star
INSERT INTO public.hospitals (slug, name, state_uf)
VALUES ('df_star', 'Hospital DF Star', 'DF');

-- user_hospitals: vinculo usuario x hospital com role local
CREATE TABLE public.user_hospitals (
  user_id uuid NOT NULL,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hospital_id, role)
);

CREATE INDEX idx_user_hospitals_user ON public.user_hospitals(user_id);
CREATE INDEX idx_user_hospitals_hospital ON public.user_hospitals(hospital_id);

GRANT SELECT ON public.user_hospitals TO authenticated;
GRANT ALL ON public.user_hospitals TO service_role;

ALTER TABLE public.user_hospitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see their own hospital links"
ON public.user_hospitals FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'diretor'));

CREATE POLICY "Admin manages hospital links"
ON public.user_hospitals FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Helpers SECURITY DEFINER (usados em RLS futuras)
CREATE OR REPLACE FUNCTION public.user_hospital_ids(_uid uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT hospital_id), ARRAY[]::uuid[])
  FROM public.user_hospitals WHERE user_id = _uid
$$;

CREATE OR REPLACE FUNCTION public.user_state_ufs(_uid uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT h.state_uf::text), ARRAY[]::text[])
  FROM public.user_hospitals uh
  JOIN public.hospitals h ON h.id = uh.hospital_id
  WHERE uh.user_id = _uid
$$;

CREATE OR REPLACE FUNCTION public.is_global_role(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'admin') OR public.has_role(_uid, 'diretor')
$$;

CREATE OR REPLACE FUNCTION public.can_access_hospital(_uid uuid, _hid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.is_global_role(_uid)
      OR EXISTS (SELECT 1 FROM public.user_hospitals WHERE user_id = _uid AND hospital_id = _hid)
$$;

-- Seed: vincula todos os usuarios atuais ao DF Star com sua role nao-global
INSERT INTO public.user_hospitals (user_id, hospital_id, role)
SELECT ur.user_id,
       (SELECT id FROM public.hospitals WHERE slug = 'df_star'),
       ur.role
FROM public.user_roles ur
WHERE ur.role IN ('analista','validador','empresa','medico')
ON CONFLICT DO NOTHING;

CREATE TABLE public.company_portal_user_hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES public.company_portal_users(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_user_id, hospital_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_portal_user_hospitals TO authenticated;
GRANT ALL ON public.company_portal_user_hospitals TO service_role;
ALTER TABLE public.company_portal_user_hospitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal user reads own company hospital links"
  ON public.company_portal_user_hospitals FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.company_portal_users cpu
            WHERE cpu.id = company_portal_user_hospitals.portal_user_id AND cpu.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "admins manage company portal hospital links"
  ON public.company_portal_user_hospitals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.doctor_portal_user_hospitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id uuid NOT NULL REFERENCES public.doctor_portal_users(id) ON DELETE CASCADE,
  hospital_id uuid NOT NULL REFERENCES public.hospitals(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (portal_user_id, hospital_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_portal_user_hospitals TO authenticated;
GRANT ALL ON public.doctor_portal_user_hospitals TO service_role;
ALTER TABLE public.doctor_portal_user_hospitals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal user reads own doctor hospital links"
  ON public.doctor_portal_user_hospitals FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.doctor_portal_users dpu
            WHERE dpu.id = doctor_portal_user_hospitals.portal_user_id AND dpu.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY "admins manage doctor portal hospital links"
  ON public.doctor_portal_user_hospitals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_cpuh_user ON public.company_portal_user_hospitals(portal_user_id);
CREATE INDEX idx_cpuh_hospital ON public.company_portal_user_hospitals(hospital_id);
CREATE INDEX idx_dpuh_user ON public.doctor_portal_user_hospitals(portal_user_id);
CREATE INDEX idx_dpuh_hospital ON public.doctor_portal_user_hospitals(hospital_id);

DROP FUNCTION IF EXISTS public.user_hospital_ids(uuid);
CREATE FUNCTION public.user_hospital_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT hospital_id FROM public.user_hospitals WHERE user_id = _user_id
  UNION
  SELECT cpuh.hospital_id
    FROM public.company_portal_user_hospitals cpuh
    JOIN public.company_portal_users cpu ON cpu.id = cpuh.portal_user_id
    WHERE cpu.user_id = _user_id AND cpu.active = true
  UNION
  SELECT dpuh.hospital_id
    FROM public.doctor_portal_user_hospitals dpuh
    JOIN public.doctor_portal_users dpu ON dpu.id = dpuh.portal_user_id
    WHERE dpu.user_id = _user_id AND dpu.active = true;
$$;

DROP FUNCTION IF EXISTS public.my_accessible_hospitals();
CREATE FUNCTION public.my_accessible_hospitals()
RETURNS TABLE (id uuid, name text, uf text, city text, active boolean, is_primary boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH primary_h AS (
    SELECT primary_hospital_id FROM public.profiles WHERE profiles.id = auth.uid()
  ),
  is_global AS (
    SELECT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','diretor')
    ) AS g
  ),
  accessible AS (
    SELECT h.id, h.name, h.state_uf AS uf, NULL::text AS city, h.active
      FROM public.hospitals h
      WHERE h.active = true
        AND ((SELECT g FROM is_global) OR h.id IN (SELECT public.user_hospital_ids(auth.uid())))
  )
  SELECT a.id, a.name, a.uf, a.city, a.active,
         COALESCE(a.id = (SELECT primary_hospital_id FROM primary_h), false) AS is_primary
    FROM accessible a
    ORDER BY a.name;
$$;
GRANT EXECUTE ON FUNCTION public.my_accessible_hospitals() TO authenticated;

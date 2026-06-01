-- Precisa DROP antes porque o retorno mudou de SETOF uuid para uuid[].
DROP FUNCTION IF EXISTS public.user_hospital_ids(uuid) CASCADE;

CREATE FUNCTION public.user_hospital_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT hid), ARRAY[]::uuid[])
  FROM (
    SELECT hospital_id AS hid
      FROM public.user_hospitals
      WHERE user_id = _user_id
    UNION
    SELECT cpuh.hospital_id
      FROM public.company_portal_user_hospitals cpuh
      JOIN public.company_portal_users cpu ON cpu.id = cpuh.portal_user_id
      WHERE cpu.user_id = _user_id AND cpu.active = true
    UNION
    SELECT dpuh.hospital_id
      FROM public.doctor_portal_user_hospitals dpuh
      JOIN public.doctor_portal_users dpu ON dpu.id = dpuh.portal_user_id
      WHERE dpu.user_id = _user_id AND dpu.active = true
  ) s;
$$;

GRANT EXECUTE ON FUNCTION public.user_hospital_ids(uuid) TO authenticated;

-- Recria hospital_scope_allows que foi dropada pelo CASCADE
CREATE OR REPLACE FUNCTION public.hospital_scope_allows(_hospital_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    auth.uid() IS NULL
    OR public.is_global_role(auth.uid())
    OR _hospital_id IS NULL
    OR _hospital_id = ANY (public.user_hospital_ids(auth.uid()))
$$;
GRANT EXECUTE ON FUNCTION public.hospital_scope_allows(uuid) TO authenticated;

-- Recria my_accessible_hospitals usando = ANY (array)
CREATE OR REPLACE FUNCTION public.my_accessible_hospitals()
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
        AND ((SELECT g FROM is_global) OR h.id = ANY(public.user_hospital_ids(auth.uid())))
  )
  SELECT a.id, a.name, a.uf, a.city, a.active,
         COALESCE(a.id = (SELECT primary_hospital_id FROM primary_h), false) AS is_primary
    FROM accessible a
    ORDER BY a.name;
$$;
GRANT EXECUTE ON FUNCTION public.my_accessible_hospitals() TO authenticated;

-- Reaplicar as policies RESTRICTIVE de escopo por hospital que dependem
-- de hospital_scope_allows e foram dropadas pelo CASCADE.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'hospital_id'
     WHERE n.nspname = 'public' AND c.relkind = 'r'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS hospital_scope_restrictive ON public.%I;
       CREATE POLICY hospital_scope_restrictive ON public.%I
         AS RESTRICTIVE FOR ALL TO authenticated
         USING (public.hospital_scope_allows(hospital_id))
         WITH CHECK (public.hospital_scope_allows(hospital_id));',
      r.tablename, r.tablename
    );
  END LOOP;
END $$;
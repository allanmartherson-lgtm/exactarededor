
-- 1) user_hospital_ids passa a incluir hospitais derivados de portais
CREATE OR REPLACE FUNCTION public.user_hospital_ids(_uid uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT hid), ARRAY[]::uuid[]) FROM (
    SELECT hospital_id AS hid
      FROM public.user_hospitals
      WHERE user_id = _uid AND hospital_id IS NOT NULL
    UNION
    SELECT DISTINCT pcg.hospital_id
      FROM public.payment_company_groups pcg
      WHERE pcg.hospital_id IS NOT NULL
        AND pcg.company_id IN (
          SELECT company_id FROM public.company_portal_users
          WHERE user_id = _uid AND active
        )
    UNION
    SELECT DISTINCT pi.hospital_id
      FROM public.payment_items pi
      WHERE pi.hospital_id IS NOT NULL
        AND pi.doctor_id IN (
          SELECT doctor_id FROM public.doctor_portal_users
          WHERE user_id = _uid AND active
        )
  ) s
$$;

-- 2) hospital_scope_allows: REMOVE isenção de portal (passa a respeitar gate)
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

-- 3) state_scope_allows mantém isenção de portal (cadastros estaduais permanecem acessíveis;
--    a granularidade por empresa/médico já é tratada pelas policies permissivas existentes)
--    (sem alteração — apenas reforço de definição)

-- 4) RPC consumida pelo HospitalContext do app
CREATE OR REPLACE FUNCTION public.my_accessible_hospitals()
RETURNS SETOF public.hospitals
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT h.* FROM public.hospitals h
  WHERE h.active
    AND (
      public.is_global_role(auth.uid())
      OR h.id = ANY(public.user_hospital_ids(auth.uid()))
    )
  ORDER BY h.name
$$;

GRANT EXECUTE ON FUNCTION public.my_accessible_hospitals() TO authenticated;

-- 5) Índices para performance dos lookups derivados
CREATE INDEX IF NOT EXISTS idx_company_portal_users_user_active
  ON public.company_portal_users(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_doctor_portal_users_user_active
  ON public.doctor_portal_users(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_payment_company_groups_company_hospital
  ON public.payment_company_groups(company_id, hospital_id);
CREATE INDEX IF NOT EXISTS idx_payment_items_doctor_hospital
  ON public.payment_items(doctor_id, hospital_id);

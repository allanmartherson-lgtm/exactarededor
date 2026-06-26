
-- 1) hospital_scope_allows / state_scope_allows: remove blanket portal bypass.
-- Portal users já têm seus hospitais agregados em user_hospital_ids(),
-- então passam normalmente pelo escopo padrão.
CREATE OR REPLACE FUNCTION public.hospital_scope_allows(_hospital_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NULL
    OR public.is_global_role(auth.uid())
    OR _hospital_id IS NULL
    OR _hospital_id = ANY(public.user_hospital_ids(auth.uid()));
$$;

-- user_state_ufs precisa incluir hospitais via portal antes de remover bypass
CREATE OR REPLACE FUNCTION public.user_state_ufs(_uid uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(DISTINCT h.state_uf::text), ARRAY[]::text[])
  FROM public.hospitals h
  WHERE h.id = ANY(public.user_hospital_ids(_uid));
$$;

CREATE OR REPLACE FUNCTION public.state_scope_allows(_state_uf text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    auth.uid() IS NULL
    OR public.is_global_role(auth.uid())
    OR _state_uf IS NULL
    OR _state_uf = ANY (public.user_state_ufs(auth.uid()));
$$;

-- 2) profiles_workflow_select: escopar para perfis de usuários que compartilham
-- pelo menos um hospital com quem está consultando (analista/validador).
DROP POLICY IF EXISTS profiles_workflow_select ON public.profiles;

CREATE POLICY profiles_workflow_select ON public.profiles
FOR SELECT TO authenticated
USING (
  (has_role(auth.uid(), 'analista'::app_role) OR has_role(auth.uid(), 'validador'::app_role))
  AND (
    auth.uid() = id
    OR EXISTS (
      SELECT 1
      FROM public.user_hospitals uh1
      JOIN public.user_hospitals uh2 ON uh2.hospital_id = uh1.hospital_id
      WHERE uh1.user_id = auth.uid()
        AND uh2.user_id = public.profiles.id
    )
  )
);

-- 3) doctors_import_staging: scope por importador.
ALTER TABLE public.doctors_import_staging
  ADD COLUMN IF NOT EXISTS imported_by uuid DEFAULT auth.uid();

DROP POLICY IF EXISTS staging_admin_all ON public.doctors_import_staging;

CREATE POLICY staging_admin_select ON public.doctors_import_staging
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    has_role(auth.uid(), 'diretor'::app_role)
    AND (imported_by IS NULL OR imported_by = auth.uid())
  )
);

CREATE POLICY staging_admin_write ON public.doctors_import_staging
FOR ALL TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role)
);

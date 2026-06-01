CREATE OR REPLACE FUNCTION public.hospital_scope_allows(_hospital_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NULL
    OR public.is_global_role(auth.uid())
    OR public.is_portal_user(auth.uid())
    OR _hospital_id IS NULL
    OR _hospital_id = ANY(public.user_hospital_ids(auth.uid()));
$$;
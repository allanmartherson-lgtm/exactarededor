REVOKE EXECUTE ON FUNCTION public.set_primary_hospital_for_user(uuid, uuid, public.app_role) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_primary_hospital_for_user(uuid, uuid, public.app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_primary_hospital_for_user(uuid, uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_hospital_for_user(uuid, uuid, public.app_role) TO service_role;
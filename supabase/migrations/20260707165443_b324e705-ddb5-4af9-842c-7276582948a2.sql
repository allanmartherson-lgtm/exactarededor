CREATE OR REPLACE FUNCTION public.assert_hospital_access(_hospital_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE='insufficient_privilege';
  END IF;
  IF _hospital_id IS NULL THEN
    RAISE EXCEPTION 'entidade sem hospital vinculado — acesso negado' USING ERRCODE='insufficient_privilege';
  END IF;
  IF NOT (public.is_global_role(auth.uid()) OR _hospital_id = public.current_active_hospital()) THEN
    RAISE EXCEPTION 'acesso negado — hospital diferente da unidade ativa' USING ERRCODE='insufficient_privilege';
  END IF;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.assert_hospital_access(uuid) TO authenticated, service_role;
DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', f.proname, f.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', f.proname, f.args);
  END LOOP;
END $$;
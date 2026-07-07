CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

DO $$
DECLARE
  ext text;
BEGIN
  FOR ext IN SELECT unnest(ARRAY['pg_trgm','unaccent','btree_gist']) LOOP
    IF EXISTS (
      SELECT 1 FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = ext AND n.nspname = 'public'
    ) THEN
      EXECUTE format('ALTER EXTENSION %I SET SCHEMA extensions', ext);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
  cur_setting text;
  new_setting text;
BEGIN
  FOR r IN
    SELECT p.oid, n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proconfig IS NOT NULL
  LOOP
    SELECT split_part(cfg, '=', 2) INTO cur_setting
    FROM unnest(r.proconfig) AS cfg
    WHERE cfg LIKE 'search_path=%'
    LIMIT 1;

    IF cur_setting IS NULL THEN CONTINUE; END IF;
    IF position('extensions' in cur_setting) > 0 THEN CONTINUE; END IF;

    new_setting := cur_setting || ', extensions';
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = %s',
      r.nspname, r.proname, r.args, new_setting
    );
  END LOOP;
END $$;
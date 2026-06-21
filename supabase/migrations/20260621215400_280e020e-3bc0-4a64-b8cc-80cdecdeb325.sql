
-- =========================================================================
-- 1) Fail-closed hospital scope: remove "current_active_hospital() IS NULL" bypass
-- =========================================================================
DO $$
DECLARE
  r record;
  v_old_qual text := '((current_active_hospital() IS NULL) OR (hospital_id IS NULL) OR (hospital_id = current_active_hospital()))';
  v_new_clause text := '((hospital_id IS NULL) OR (hospital_id = current_active_hospital()))';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname = 'active_hospital_scope'
       AND (qual = v_old_qual OR with_check = v_old_qual)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO %s USING (%s) WITH CHECK (%s)',
      r.policyname,
      r.schemaname,
      r.tablename,
      array_to_string(r.roles, ','),
      v_new_clause,
      v_new_clause
    );
  END LOOP;
END $$;

-- =========================================================================
-- 2) Enable RLS on realtime.messages (postgres_changes-only usage)
--    Allow only authenticated users to subscribe. App uses postgres_changes
--    on public.* tables, which still pass through each table's own RLS.
-- =========================================================================
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can use realtime" ON realtime.messages;
CREATE POLICY "Authenticated can use realtime"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated can publish broadcast" ON realtime.messages;
CREATE POLICY "Authenticated can publish broadcast"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (true);


CREATE OR REPLACE FUNCTION public._install_hospital_scope_restrictive(_table regclass)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_name text := 'hospital_scope_restrictive';
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_name, _table);
  EXECUTE format($p$
    CREATE POLICY %I ON %s
    AS RESTRICTIVE
    FOR ALL
    TO authenticated
    USING (
      public.is_global_role(auth.uid())
      OR hospital_id IS NULL
      OR hospital_id = public.current_active_hospital()
    )
    WITH CHECK (
      public.is_global_role(auth.uid())
      OR hospital_id IS NULL
      OR hospital_id = public.current_active_hospital()
    )
  $p$, v_name, _table);
END;
$$;

SELECT public._install_hospital_scope_restrictive('public.convenios');
SELECT public._install_hospital_scope_restrictive('public.sectors');
SELECT public._install_hospital_scope_restrictive('public.convenio_aliases');
SELECT public._install_hospital_scope_restrictive('public.sector_aliases');
SELECT public._install_hospital_scope_restrictive('public.payout_models');
SELECT public._install_hospital_scope_restrictive('public.payout_tier_tables');
SELECT public._install_hospital_scope_restrictive('public.special_case_types');
SELECT public._install_hospital_scope_restrictive('public.special_case_marks');
SELECT public._install_hospital_scope_restrictive('public.system_parameter_overrides');
SELECT public._install_hospital_scope_restrictive('public.manual_intervention_reasons');
SELECT public._install_hospital_scope_restrictive('public.reference_tables');
SELECT public._install_hospital_scope_restrictive('public.reference_table_items');
SELECT public._install_hospital_scope_restrictive('public.reference_table_port_values');
SELECT public._install_hospital_scope_restrictive('public.sla_settings');
SELECT public._install_hospital_scope_restrictive('public.communication_sla_settings');

DROP FUNCTION public._install_hospital_scope_restrictive(regclass);

-- Amplia audit_hospital_scope() para varrer TODAS as tabelas com hospital_id.
DROP FUNCTION IF EXISTS public.audit_hospital_scope();

CREATE FUNCTION public.audit_hospital_scope()
RETURNS TABLE(proname text, args text, missing_scope_for text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tables text[];
BEGIN
  SELECT array_agg(DISTINCT c.table_name)
    INTO v_tables
    FROM information_schema.columns c
    JOIN information_schema.tables t USING (table_schema, table_name)
   WHERE c.table_schema = 'public'
     AND c.column_name  = 'hospital_id'
     AND t.table_type   = 'BASE TABLE';

  RETURN QUERY
  WITH funcs AS (
    SELECT p.oid,
           p.proname::text                                       AS proname,
           pg_get_function_identity_arguments(p.oid)              AS args,
           pg_get_functiondef(p.oid)                              AS body
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef = true
  )
  SELECT f.proname, f.args, tab
    FROM funcs f
    CROSS JOIN LATERAL unnest(v_tables) AS tab
   WHERE f.body ~* ('\m' || tab || '\M')
     AND f.body NOT ILIKE '%current_active_hospital%'
     AND f.body NOT ILIKE '%hospital_scope_allows%'
     AND f.body NOT ILIKE '%portal_can_access_doctor%'
     AND f.body NOT ILIKE '%doctor_portal_users%'
     AND f.proname NOT IN (
       'audit_hospital_scope',
       'enforce_hospital_scope',
       'rls_test_setup',
       'rls_test_cleanup',
       'rls_test_hospital_tables',
       'my_accessible_hospitals',
       'user_hospital_ids',
       'is_global_role',
       'set_active_hospital',
       'log_hospital_switch'
     );
END;
$$;

GRANT EXECUTE ON FUNCTION public.audit_hospital_scope() TO service_role;

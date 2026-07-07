
ALTER VIEW public.isolation_events SET (security_invoker = on);

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'apply_zeev_bulk_manual',
    'assert_hospital_access',
    'audit_hospital_scope',
    'audit_log_set_hospital',
    'enforce_hospital_scope',
    'get_intervention_preview',
    'get_isolation_events',
    'invalidate_company_financials_snapshot_statement',
    'is_company_portal_user',
    'materialize_intervention_ledger',
    'tg_intervention_ledger_on_status',
    'trg_recalc_priority_related_statement',
    'upsert_payment_company_financials_snapshot',
    'user_can_see_hospital'
  ];
  sig text;
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    FOR sig IN
      SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', sig);
    END LOOP;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.get_isolation_events(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_intervention_preview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_hospital_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_see_hospital(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_portal_user(uuid, uuid) TO authenticated;

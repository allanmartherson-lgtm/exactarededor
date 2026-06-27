-- 1) Remove NULL-hospital bypass from hospital_scope_allows.
-- Project memory previously allowed it for "legacy/global" rows, but the flagged
-- tables (reconciliation_*, glosa_*, conciliation_bases, payment_pivot_cache)
-- are operational and must always carry hospital_id. Global roles still bypass
-- via is_global_role; nothing else may read rows with NULL hospital_id.
CREATE OR REPLACE FUNCTION public.hospital_scope_allows(_hospital_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    auth.uid() IS NULL
    OR public.is_global_role(auth.uid())
    OR (
      _hospital_id IS NOT NULL
      AND _hospital_id = ANY(public.user_hospital_ids(auth.uid()))
    );
$function$;

-- 2) payment_pivot_cache: add permissive SELECT for internal workflow roles.
-- Restrictive policies (active_hospital_scope, hospital_scope_restrictive) still
-- apply on top, so users only see rows for their hospital.
DROP POLICY IF EXISTS "payment_pivot_cache_select_workflow" ON public.payment_pivot_cache;
CREATE POLICY "payment_pivot_cache_select_workflow"
  ON public.payment_pivot_cache
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'analista'::public.app_role)
    OR public.has_role(auth.uid(), 'validador'::public.app_role)
    OR public.has_role(auth.uid(), 'diretor'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- 3) Realtime broadcast: drop the wide-open permissive publish policy.
-- A restrictive deny_all_authenticated policy already blocks publish/select; the
-- app uses postgres_changes (replication), not broadcast/presence. Removing the
-- permissive INSERT policy closes the topic-impersonation surface flagged by the
-- scanner. If broadcast is ever needed, add a topic-scoped policy at that time.
DROP POLICY IF EXISTS "Authenticated can publish broadcast" ON realtime.messages;

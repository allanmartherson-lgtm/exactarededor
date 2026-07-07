
DROP POLICY IF EXISTS dc_view_authenticated ON public.doctor_companies;
CREATE POLICY dc_view_internal_or_portal ON public.doctor_companies
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'diretor'::app_role)
  OR has_role(auth.uid(), 'analista'::app_role)
  OR has_role(auth.uid(), 'validador'::app_role)
  OR has_role(auth.uid(), 'gestao_medica'::app_role)
  OR EXISTS (SELECT 1 FROM public.doctor_portal_users dpu WHERE dpu.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.company_portal_users cpu WHERE cpu.user_id = auth.uid())
);

CREATE OR REPLACE VIEW public.isolation_events AS
SELECT
  id,
  created_at,
  actor_id,
  action,
  entity_type,
  entity_id,
  hospital_id,
  company_id,
  company_name,
  diff
FROM public.audit_log
WHERE action IN (
  'hospital_scope_violation',
  'rls_denied',
  'cross_hospital_attempt',
  'hospital_mismatch'
) OR (diff::text ILIKE '%hospital_id%' AND diff::text ILIKE '%denied%');

GRANT SELECT ON public.isolation_events TO authenticated;

CREATE OR REPLACE FUNCTION public.get_isolation_events(_days integer DEFAULT 30, _limit integer DEFAULT 200)
RETURNS SETOF public.isolation_events
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.isolation_events
  WHERE (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'diretor'::app_role))
    AND created_at >= now() - (_days || ' days')::interval
  ORDER BY created_at DESC
  LIMIT _limit
$$;

GRANT EXECUTE ON FUNCTION public.get_isolation_events(integer, integer) TO authenticated;

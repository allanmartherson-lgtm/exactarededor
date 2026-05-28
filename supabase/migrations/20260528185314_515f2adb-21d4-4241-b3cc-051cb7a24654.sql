
CREATE OR REPLACE FUNCTION public.payments_global_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  archived_count bigint;
  competences text[];
  analyst_ids uuid[];
  analysts jsonb;
BEGIN
  SELECT count(*) INTO archived_count
  FROM payments
  WHERE status IN ('lancado','pago','rejeitado','cancelado','arquivado');

  SELECT array_agg(DISTINCT to_char(c, 'YYYY-MM') ORDER BY to_char(c, 'YYYY-MM') DESC)
  INTO competences
  FROM (
    SELECT competence_month::date AS c FROM payments WHERE competence_month IS NOT NULL
    UNION ALL
    SELECT unnest(competence_months)::date AS c FROM payments WHERE competence_months IS NOT NULL
  ) t
  WHERE c IS NOT NULL;

  SELECT array_agg(DISTINCT created_by) INTO analyst_ids
  FROM payments WHERE created_by IS NOT NULL;

  SELECT jsonb_object_agg(p.id::text, COALESCE(p.full_name, p.email, '—'))
  INTO analysts
  FROM profiles p
  WHERE p.id = ANY(COALESCE(analyst_ids, ARRAY[]::uuid[]));

  RETURN jsonb_build_object(
    'archived_count', archived_count,
    'competences', COALESCE(to_jsonb(competences), '[]'::jsonb),
    'analysts', COALESCE(analysts, '{}'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.payments_global_stats() TO authenticated, service_role;

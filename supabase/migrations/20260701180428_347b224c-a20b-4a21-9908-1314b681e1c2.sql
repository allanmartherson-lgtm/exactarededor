DROP POLICY IF EXISTS active_hospital_scope ON public.payment_company_groups;
DROP POLICY IF EXISTS hospital_scope_restrictive ON public.payment_company_groups;
DROP POLICY IF EXISTS active_hospital_scope ON public.payments;
DROP POLICY IF EXISTS hospital_scope_restrictive ON public.payments;

CREATE POLICY active_hospital_scope
ON public.payment_company_groups
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  hospital_id IS NULL
  OR hospital_id = (SELECT public.current_active_hospital())
)
WITH CHECK (
  hospital_id IS NULL
  OR hospital_id = (SELECT public.current_active_hospital())
);

CREATE POLICY hospital_scope_restrictive
ON public.payment_company_groups
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  (SELECT public.is_global_role(auth.uid()))
  OR (
    hospital_id IS NOT NULL
    AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
  )
)
WITH CHECK (
  (SELECT public.is_global_role(auth.uid()))
  OR (
    hospital_id IS NOT NULL
    AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
  )
);

CREATE POLICY active_hospital_scope
ON public.payments
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  hospital_id IS NULL
  OR hospital_id = (SELECT public.current_active_hospital())
)
WITH CHECK (
  hospital_id IS NULL
  OR hospital_id = (SELECT public.current_active_hospital())
);

CREATE POLICY hospital_scope_restrictive
ON public.payments
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  (SELECT public.is_global_role(auth.uid()))
  OR (
    hospital_id IS NOT NULL
    AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
  )
)
WITH CHECK (
  (SELECT public.is_global_role(auth.uid()))
  OR (
    hospital_id IS NOT NULL
    AND hospital_id = ANY(public.user_hospital_ids((SELECT auth.uid())))
  )
);

CREATE OR REPLACE FUNCTION public.dashboard_pending_company_groups(
  _created_by uuid,
  _status public.payment_status
)
RETURNS TABLE(payment_id uuid, reference text, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS payment_id, COALESCE(p.reference, '—') AS reference, COUNT(g.id)::bigint AS count
  FROM public.payments p
  JOIN public.payment_company_groups g ON g.payment_id = p.id
  WHERE p.created_by = _created_by
    AND g.status = _status
    AND p.is_test IS NOT TRUE
    AND g.is_test IS NOT TRUE
    AND (
      p.hospital_id IS NULL
      OR p.hospital_id = public.current_active_hospital()
      OR public.is_global_role(auth.uid())
      OR p.hospital_id = ANY(public.user_hospital_ids(auth.uid()))
    )
  GROUP BY p.id, p.reference
  ORDER BY p.reference;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_pending_company_groups(uuid, public.payment_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_pending_company_groups(uuid, public.payment_status) TO service_role;

CREATE OR REPLACE FUNCTION public.dashboard_invoice_counts(_created_by uuid)
RETURNS TABLE(status public.invoice_status, count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.status, COUNT(*)::bigint AS count
  FROM public.invoices i
  JOIN public.payments p ON p.id = i.payment_id
  WHERE p.created_by = _created_by
    AND i.status IN ('aguardando', 'recebida', 'conciliada')
    AND p.is_test IS NOT TRUE
    AND (
      p.hospital_id IS NULL
      OR p.hospital_id = public.current_active_hospital()
      OR public.is_global_role(auth.uid())
      OR p.hospital_id = ANY(public.user_hospital_ids(auth.uid()))
    )
  GROUP BY i.status;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_invoice_counts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_invoice_counts(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.dashboard_company_invoice_questions(_created_by uuid)
RETURNS TABLE(count bigint, first_payment_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_questions AS (
    SELECT iq.payment_id
    FROM public.invoice_questions iq
    JOIN public.invoices i ON i.id = iq.invoice_id
    JOIN public.payments p ON p.id = iq.payment_id
    WHERE p.created_by = _created_by
      AND iq.author_type = 'recebedor'
      AND iq.read_at IS NULL
      AND i.status IN ('aguardando', 'recebida', 'divergente')
      AND p.is_test IS NOT TRUE
      AND (
        p.hospital_id IS NULL
        OR p.hospital_id = public.current_active_hospital()
        OR public.is_global_role(auth.uid())
        OR p.hospital_id = ANY(public.user_hospital_ids(auth.uid()))
      )
    ORDER BY iq.created_at ASC
  )
  SELECT COUNT(*)::bigint AS count, (ARRAY_AGG(payment_id))[1] AS first_payment_id
  FROM active_questions;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_company_invoice_questions(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_company_invoice_questions(uuid) TO service_role;
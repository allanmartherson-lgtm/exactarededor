CREATE OR REPLACE FUNCTION public.dashboard_pending_company_groups(_created_by uuid, _status payment_status)
 RETURNS TABLE(payment_id uuid, reference text, count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id AS payment_id, COALESCE(p.reference, '—') AS reference, COUNT(g.id)::bigint AS count
  FROM public.payments p
  JOIN public.payment_company_groups g ON g.payment_id = p.id
  WHERE p.created_by = _created_by
    AND g.status = _status
    AND p.is_test IS NOT TRUE
    AND g.is_test IS NOT TRUE
    AND p.hospital_id IS NOT DISTINCT FROM public.current_active_hospital()
  GROUP BY p.id, p.reference
  ORDER BY p.reference;
$function$;

CREATE OR REPLACE FUNCTION public.get_exacta_principal_procedure_names(p_hospital_id uuid)
RETURNS TABLE(procedure_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT pi.procedure_name
  FROM public.payment_items pi
  WHERE pi.hospital_id = p_hospital_id
    AND pi.is_cancelled = false
    AND pi.procedure_name IS NOT NULL
    AND pi.procedure_name <> ''
    AND (
      pi.access_route ILIKE '%nica%'
      OR pi.access_route ILIKE '%principal%'
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_exacta_principal_procedure_names(uuid) TO authenticated, service_role;

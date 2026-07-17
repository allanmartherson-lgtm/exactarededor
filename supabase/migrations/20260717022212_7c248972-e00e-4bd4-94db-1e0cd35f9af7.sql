
DROP FUNCTION IF EXISTS public.get_exacta_principal_procedure_names(uuid);

CREATE FUNCTION public.get_exacta_principal_procedure_names(p_hospital_id uuid)
RETURNS TABLE(procedure_name text, origem text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT pi.procedure_name AS procedure_name, 'pagamento'::text AS origem
    FROM public.payment_items pi
   WHERE pi.hospital_id = p_hospital_id
     AND pi.is_cancelled = false
     AND pi.procedure_name IS NOT NULL
     AND pi.procedure_name <> ''
     AND (pi.access_route ILIKE '%nica%' OR pi.access_route ILIKE '%principal%')
  UNION
  SELECT DISTINCT rti.description AS procedure_name, 'cbhpm'::text AS origem
    FROM public.reference_table_items rti
    JOIN public.reference_tables rt ON rt.id = rti.reference_table_id
   WHERE rt.name ILIKE '%cbhpm%'
     AND rti.description IS NOT NULL
     AND rti.description <> '';
$$;

GRANT EXECUTE ON FUNCTION public.get_exacta_principal_procedure_names(uuid) TO authenticated, service_role;

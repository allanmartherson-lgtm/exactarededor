DROP FUNCTION IF EXISTS public.get_specialty_payments_agg(uuid, date, date);

CREATE OR REPLACE FUNCTION public.get_specialty_payments_agg(p_hospital uuid, p_from date, p_to date)
 RETURNS TABLE(competence date, payment_id uuid, company_id uuid, doctor_id uuid, item_type_id uuid, convenio_slug text, gross numeric, items bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  PERFORM public.assert_hospital_access(p_hospital);

  RETURN QUERY
  WITH src AS (
    SELECT
      date_trunc('month', pi.item_competence)::date AS competence,
      pi.payment_id,
      pi.company_id,
      pi.doctor_id,
      pi.item_type_id,
      NULLIF(btrim(COALESCE(pi.convenio_slug, '')), '') AS convenio_slug,
      COALESCE(pi.gross_amount, 0)::numeric AS gross,
      CASE
        WHEN pi.doctor_id IS NULL AND COALESCE(pi.doctor_name, '') <> ''
        THEN lower(extensions.unaccent(regexp_replace(trim(pi.doctor_name), '\s+', ' ', 'g')))
      END AS norm_name
    FROM public.payment_items pi
    WHERE pi.hospital_id = p_hospital
      AND pi.item_competence IS NOT NULL
      AND pi.item_competence >= p_from
      AND pi.item_competence <= p_to
      AND COALESCE(pi.is_cancelled, false) = false
  ),
  names AS (
    SELECT DISTINCT norm_name FROM src WHERE norm_name IS NOT NULL
  ),
  by_alias AS (
    SELECT n.norm_name, (array_agg(DISTINCT da.doctor_id))[1] AS doctor_id
    FROM names n
    JOIN public.doctor_aliases da ON da.alias_normalized = n.norm_name
    GROUP BY n.norm_name
    HAVING count(DISTINCT da.doctor_id) = 1
  ),
  by_name AS (
    SELECT n.norm_name, (array_agg(DISTINCT d.id))[1] AS doctor_id
    FROM names n
    JOIN public.doctors d
      ON lower(extensions.unaccent(regexp_replace(trim(d.full_name), '\s+', ' ', 'g'))) = n.norm_name
    GROUP BY n.norm_name
    HAVING count(DISTINCT d.id) = 1
  )
  SELECT
    s.competence,
    s.payment_id,
    s.company_id,
    COALESCE(s.doctor_id, a.doctor_id, b.doctor_id) AS doctor_id,
    s.item_type_id,
    s.convenio_slug,
    SUM(s.gross)::numeric AS gross,
    COUNT(*)::bigint AS items
  FROM src s
  LEFT JOIN by_alias a ON a.norm_name = s.norm_name
  LEFT JOIN by_name  b ON b.norm_name = s.norm_name
  GROUP BY 1, 2, 3, 4, 5, 6
  ORDER BY 1, 2, 3, 4, 5, 6;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_specialty_payments_agg(uuid, date, date) TO authenticated;
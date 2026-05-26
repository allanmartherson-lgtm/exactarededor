
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.norm_name(t text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT lower(regexp_replace(coalesce(public.unaccent(t), ''), '\s+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.enrich_doctor_documents()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer := 0;
BEGIN
  WITH src AS (
    SELECT pi.id AS item_id, (d.crm || '/' || d.crm_uf) AS doc, d.id AS d_id
    FROM payment_items pi
    JOIN doctors d ON public.norm_name(trim(d.full_name)) = public.norm_name(trim(pi.doctor_name))
    WHERE (pi.doctor_document IS NULL OR pi.doctor_document = '')
      AND pi.doctor_name IS NOT NULL AND pi.doctor_name <> ''
      AND d.crm IS NOT NULL AND d.crm_uf IS NOT NULL
  )
  UPDATE payment_items pi
  SET doctor_document = src.doc,
      doctor_id = COALESCE(pi.doctor_id, src.d_id)
  FROM src
  WHERE pi.id = src.item_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  WITH src AS (
    SELECT pi.id AS item_id, d.id AS d_id
    FROM payment_items pi
    JOIN doctors d
      ON d.crm = split_part(pi.doctor_document, '/', 1)
     AND d.crm_uf = split_part(pi.doctor_document, '/', 2)
    WHERE pi.doctor_id IS NULL
      AND pi.doctor_document IS NOT NULL
      AND position('/' in pi.doctor_document) > 0
  )
  UPDATE payment_items pi
  SET doctor_id = src.d_id
  FROM src
  WHERE pi.id = src.item_id;

  WITH src AS (
    SELECT pi.id AS item_id, d.id AS d_id
    FROM payment_items pi
    JOIN doctors d ON public.norm_name(trim(d.full_name)) = public.norm_name(trim(pi.doctor_name))
    WHERE pi.doctor_id IS NULL
      AND pi.doctor_name IS NOT NULL AND pi.doctor_name <> ''
  )
  UPDATE payment_items pi
  SET doctor_id = src.d_id
  FROM src
  WHERE pi.id = src.item_id;

  RETURN updated_count;
END;
$$;

SELECT public.enrich_doctor_documents();

CREATE OR REPLACE FUNCTION public.get_registration_pending_doctors()
RETURNS TABLE(
  kind text,
  doctor_name text,
  doctor_document text,
  doctor_id uuid,
  company_id uuid,
  company_name text,
  items_count bigint,
  total_amount numeric,
  last_seen_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    'doctor_unregistered'::text,
    MAX(doctor_name),
    NULLIF(trim(doctor_document), ''),
    NULL::uuid,
    NULL::uuid,
    NULL::text,
    COUNT(*)::bigint,
    COALESCE(SUM(gross_amount),0),
    MAX(created_at)
  FROM public.v_payment_items_registration_issues
  WHERE doctor_unregistered
  GROUP BY NULLIF(trim(doctor_document), ''), public.norm_name(trim(doctor_name))

  UNION ALL

  SELECT
    'pj_not_linked'::text,
    d.full_name,
    NULLIF(d.crm || '/' || d.crm_uf, '/'),
    v.doctor_id,
    v.company_id,
    c.name,
    COUNT(*)::bigint,
    COALESCE(SUM(v.gross_amount),0),
    MAX(v.created_at)
  FROM public.v_payment_items_registration_issues v
  LEFT JOIN public.doctors d ON d.id = v.doctor_id
  LEFT JOIN public.companies c ON c.id = v.company_id
  WHERE v.pj_not_linked_to_doctor
  GROUP BY d.full_name, d.crm, d.crm_uf, v.doctor_id, v.company_id, c.name
  ORDER BY 7 DESC;
$$;

GRANT EXECUTE ON FUNCTION public.norm_name(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_registration_pending_doctors() TO authenticated;
GRANT EXECUTE ON FUNCTION public.enrich_doctor_documents() TO authenticated, service_role;

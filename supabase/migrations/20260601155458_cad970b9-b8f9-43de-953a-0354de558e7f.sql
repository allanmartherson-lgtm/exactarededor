CREATE OR REPLACE FUNCTION public.rule_pending_doctors(p_rule_id uuid)
RETURNS TABLE(rule_id uuid, company_id uuid, company_name text, doctor_id uuid, doctor_name text, doctor_crm text, doctor_crm_uf text, linked_since timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT id, group_company_links, updated_at
    FROM public.rules
    WHERE id = p_rule_id AND active = true
  ),
  links AS (
    SELECT
      r.id AS rule_id,
      r.updated_at AS rule_updated_at,
      (link->>'company_id')::uuid AS company_id,
      COALESCE(link->'doctors', '[]'::jsonb) AS doctors_json,
      COALESCE(link->'excluded_doctors', '[]'::jsonb) AS excluded_json
    FROM r, jsonb_array_elements(r.group_company_links) AS link
    WHERE (link->>'company_id') IS NOT NULL
      AND jsonb_typeof(COALESCE(link->'doctors', '[]'::jsonb)) = 'array'
      AND jsonb_array_length(COALESCE(link->'doctors', '[]'::jsonb)) > 0
  ),
  norm_allow AS (
    SELECT
      l.rule_id, l.company_id,
      lower(trim(d->>'name')) AS allow_name,
      regexp_replace(COALESCE(d->>'crm',''), '\D', '', 'g') AS allow_crm
    FROM links l, jsonb_array_elements(l.doctors_json) AS d
  ),
  norm_excl AS (
    SELECT
      l.rule_id, l.company_id,
      lower(trim(d->>'name')) AS excl_name,
      regexp_replace(COALESCE(d->>'crm',''), '\D', '', 'g') AS excl_crm
    FROM links l, jsonb_array_elements(l.excluded_json) AS d
  )
  SELECT
    l.rule_id,
    l.company_id,
    c.name AS company_name,
    d.id AS doctor_id,
    d.full_name AS doctor_name,
    d.crm AS doctor_crm,
    d.crm_uf AS doctor_crm_uf,
    dc.created_at AS linked_since
  FROM links l
  JOIN public.doctor_companies dc ON dc.company_id = l.company_id
    AND (dc.end_date IS NULL OR dc.end_date >= CURRENT_DATE)
  JOIN public.doctors d ON d.id = dc.doctor_id AND d.active = true
  JOIN public.companies c ON c.id = l.company_id
  -- Só considera "novo" o vínculo criado APÓS a última edição da regra.
  -- Ao salvar (incluindo/excluindo), rules.updated_at avança e o alerta limpa.
  WHERE dc.created_at > l.rule_updated_at
  AND NOT EXISTS (
    SELECT 1 FROM norm_allow na
    WHERE na.rule_id = l.rule_id AND na.company_id = l.company_id
      AND (
        (na.allow_crm <> '' AND na.allow_crm = regexp_replace(COALESCE(d.crm,''), '\D', '', 'g'))
        OR (na.allow_name = lower(trim(d.full_name)))
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM norm_excl ne
    WHERE ne.rule_id = l.rule_id AND ne.company_id = l.company_id
      AND (
        (ne.excl_crm <> '' AND ne.excl_crm = regexp_replace(COALESCE(d.crm,''), '\D', '', 'g'))
        OR (ne.excl_name = lower(trim(d.full_name)))
      )
  );
$function$;
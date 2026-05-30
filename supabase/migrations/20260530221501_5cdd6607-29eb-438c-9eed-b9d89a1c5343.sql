
-- Função: lista médicos de empresas vinculadas a uma regra que estão na empresa
-- mas NÃO estão na allowlist específica do link (group_company_links[].doctors),
-- e NÃO estão na lista de exclusão (group_company_links[].excluded_doctors).
-- Usada pelo card da regra, pelo painel de saúde e pela notificação ao supervisor.
CREATE OR REPLACE FUNCTION public.rule_pending_doctors(p_rule_id uuid)
RETURNS TABLE (
  rule_id uuid,
  company_id uuid,
  company_name text,
  doctor_id uuid,
  doctor_name text,
  doctor_crm text,
  doctor_crm_uf text,
  linked_since timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH r AS (
    SELECT id, group_company_links
    FROM public.rules
    WHERE id = p_rule_id AND active = true
  ),
  links AS (
    SELECT
      r.id AS rule_id,
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
  WHERE NOT EXISTS (
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
$$;

GRANT EXECUTE ON FUNCTION public.rule_pending_doctors(uuid) TO authenticated, service_role;

-- View agregada: total de pendentes por regra (para badge no card e dashboard de saúde)
CREATE OR REPLACE VIEW public.rules_pending_doctors_summary AS
SELECT
  r.id AS rule_id,
  r.name AS rule_name,
  COUNT(p.doctor_id) AS pending_count,
  COUNT(DISTINCT p.company_id) AS pending_companies
FROM public.rules r
LEFT JOIN LATERAL public.rule_pending_doctors(r.id) p ON true
WHERE r.active = true
  AND r.scope = 'grupo'
GROUP BY r.id, r.name;

GRANT SELECT ON public.rules_pending_doctors_summary TO authenticated, service_role;

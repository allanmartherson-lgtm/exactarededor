-- View: marca cada payment_item com flags de pendência de cadastro
CREATE OR REPLACE VIEW public.v_payment_items_registration_issues AS
SELECT
  pi.id AS item_id,
  pi.payment_id,
  pi.doctor_id,
  pi.doctor_name,
  pi.doctor_document,
  pi.company_id,
  pi.company_name,
  pi.gross_amount,
  pi.created_at,
  -- médico não cadastrado: tem nome mas não conseguiu casar com doctors
  (pi.doctor_id IS NULL AND COALESCE(NULLIF(trim(pi.doctor_name), ''), NULLIF(trim(pi.doctor_document), '')) IS NOT NULL) AS doctor_unregistered,
  -- PJ pagadora não vinculada ao médico cadastrado
  (
    pi.doctor_id IS NOT NULL
    AND pi.company_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.doctor_companies dc
      WHERE dc.doctor_id = pi.doctor_id AND dc.company_id = pi.company_id
    )
  ) AS pj_not_linked_to_doctor
FROM public.payment_items pi;

GRANT SELECT ON public.v_payment_items_registration_issues TO authenticated;
GRANT SELECT ON public.v_payment_items_registration_issues TO service_role;

-- Resumo global para Dashboard
CREATE OR REPLACE FUNCTION public.get_registration_pending_summary()
RETURNS TABLE(
  unregistered_doctors bigint,
  unlinked_pj_pairs bigint,
  affected_items bigint,
  affected_amount numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH src AS (
    SELECT * FROM public.v_payment_items_registration_issues
    WHERE doctor_unregistered OR pj_not_linked_to_doctor
  )
  SELECT
    (SELECT COUNT(DISTINCT COALESCE(NULLIF(trim(doctor_document),''), lower(trim(doctor_name)))) FROM src WHERE doctor_unregistered),
    (SELECT COUNT(*) FROM (SELECT DISTINCT doctor_id, company_id FROM src WHERE pj_not_linked_to_doctor) s),
    (SELECT COUNT(*) FROM src),
    (SELECT COALESCE(SUM(gross_amount),0) FROM src);
$$;

GRANT EXECUTE ON FUNCTION public.get_registration_pending_summary() TO authenticated;

-- Lista detalhada para tela de Médicos
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
  -- Médicos não cadastrados (agrupados por documento ou nome)
  SELECT
    'doctor_unregistered'::text AS kind,
    MAX(doctor_name) AS doctor_name,
    NULLIF(trim(doctor_document), '') AS doctor_document,
    NULL::uuid AS doctor_id,
    NULL::uuid AS company_id,
    NULL::text AS company_name,
    COUNT(*)::bigint AS items_count,
    COALESCE(SUM(gross_amount),0) AS total_amount,
    MAX(created_at) AS last_seen_at
  FROM public.v_payment_items_registration_issues
  WHERE doctor_unregistered
  GROUP BY NULLIF(trim(doctor_document), ''), lower(trim(doctor_name))

  UNION ALL

  -- PJs não vinculadas ao médico
  SELECT
    'pj_not_linked'::text AS kind,
    d.full_name AS doctor_name,
    NULLIF(d.crm || '/' || d.crm_uf, '/') AS doctor_document,
    v.doctor_id,
    v.company_id,
    c.name AS company_name,
    COUNT(*)::bigint AS items_count,
    COALESCE(SUM(v.gross_amount),0) AS total_amount,
    MAX(v.created_at) AS last_seen_at
  FROM public.v_payment_items_registration_issues v
  LEFT JOIN public.doctors d ON d.id = v.doctor_id
  LEFT JOIN public.companies c ON c.id = v.company_id
  WHERE v.pj_not_linked_to_doctor
  GROUP BY d.full_name, d.crm, d.crm_uf, v.doctor_id, v.company_id, c.name
  ORDER BY items_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_registration_pending_doctors() TO authenticated;
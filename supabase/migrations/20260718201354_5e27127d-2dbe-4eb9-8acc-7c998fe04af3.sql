CREATE OR REPLACE FUNCTION public.get_dre_consolidated(
  p_competencia_from date DEFAULT NULL::date,
  p_competencia_to date DEFAULT NULL::date,
  p_company_id uuid DEFAULT NULL::uuid,
  p_doctor_id uuid DEFAULT NULL::uuid,
  p_track text DEFAULT NULL::text
)
RETURNS TABLE(competencia date, company_id uuid, company_name text, doctor_id uuid, doctor_name text, bruto numeric, debitos numeric, creditos numeric, glosas numeric, pool numeric, liquido numeric, payments_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH fin AS (
    SELECT
      date_trunc('month', p.competence_month)::date AS competencia,
      pcf.company_id,
      COALESCE(SUM(pcf.bruto),0)    AS bruto,
      COALESCE(SUM(pcf.debitos),0)  AS debitos,
      COALESCE(SUM(pcf.creditos),0) AS creditos,
      COALESCE(SUM(pcf.glosas),0)   AS glosas,
      COALESCE(SUM(pcf.pool),0)     AS pool,
      COUNT(DISTINCT pcf.payment_id) AS payments_count
    FROM public.payment_company_financials pcf
    JOIN public.payments p ON p.id = pcf.payment_id
    WHERE p.competence_month IS NOT NULL
      AND (p_competencia_from IS NULL OR date_trunc('month', p.competence_month)::date >= p_competencia_from)
      AND (p_competencia_to   IS NULL OR date_trunc('month', p.competence_month)::date <= p_competencia_to)
      AND (p_company_id IS NULL OR pcf.company_id = p_company_id)
      AND p.hospital_id = current_active_hospital()
      AND (
        p_track IS NULL
        OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
        OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
      )
    GROUP BY 1, 2
  ),
  docs AS (
    SELECT
      date_trunc('month', p.competence_month)::date AS competencia,
      pi.company_id,
      COUNT(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL) AS n_docs,
      (array_agg(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL))[1] AS rep_doctor_id
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.company_id IS NOT NULL
      AND p.competence_month IS NOT NULL
      AND p.hospital_id = current_active_hospital()
    GROUP BY 1, 2
  )
  SELECT
    f.competencia,
    f.company_id,
    c.name AS company_name,
    CASE WHEN d.n_docs = 1 THEN d.rep_doctor_id ELSE NULL END AS doctor_id,
    CASE WHEN d.n_docs = 1 THEN (SELECT dd.full_name FROM public.doctors dd WHERE dd.id = d.rep_doctor_id)
         WHEN d.n_docs > 1 THEN 'Vários médicos'
         ELSE NULL END AS doctor_name,
    f.bruto, f.debitos, f.creditos, f.glosas, f.pool,
    (f.bruto - f.debitos + f.creditos - f.glosas + f.pool) AS liquido,
    f.payments_count
  FROM fin f
  LEFT JOIN public.companies c ON c.id = f.company_id
  LEFT JOIN docs d ON d.competencia = f.competencia AND d.company_id = f.company_id
  WHERE (p_doctor_id IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_items pi2
          JOIN public.payments p2 ON p2.id = pi2.payment_id
          WHERE pi2.company_id = f.company_id
            AND pi2.doctor_id = p_doctor_id
            AND p2.competence_month IS NOT NULL
            AND date_trunc('month', p2.competence_month)::date = f.competencia
            AND p2.hospital_id = current_active_hospital()
        ))
  ORDER BY f.competencia DESC, c.name;
$function$;
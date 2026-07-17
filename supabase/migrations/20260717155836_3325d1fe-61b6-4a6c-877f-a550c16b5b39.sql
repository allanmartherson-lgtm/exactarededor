CREATE OR REPLACE FUNCTION public.get_overlap_audit(
  p_start date,
  p_end date,
  p_item_scope text DEFAULT 'both',
  p_min_distinct integer DEFAULT 2,
  p_specialty_mode text DEFAULT 'primary',
  p_excluded_specs text[] DEFAULT ARRAY['infectologia']::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hospital uuid := public.current_active_hospital();
  v_result jsonb;
BEGIN
  IF v_hospital IS NULL THEN
    RETURN jsonb_build_object(
      'by_specialty_combo', '[]'::jsonb,
      'by_patient',         '[]'::jsonb,
      'by_attendance',      '[]'::jsonb,
      'totals', jsonb_build_object('patients',0,'days',0,'attendances',0,'items',0)
    );
  END IF;

  WITH excl AS (
    SELECT array(
      SELECT lower(unaccent(coalesce(x,'')))
      FROM unnest(coalesce(p_excluded_specs, ARRAY[]::text[])) x
    ) AS specs
  ),
  eligible AS (
    SELECT
      pi.id,
      pi.payment_id,
      pi.attendance_number,
      pi.patient_name,
      lower(unaccent(trim(coalesce(pi.patient_name,'')))) AS patient_key,
      (pi.procedure_date AT TIME ZONE 'America/Sao_Paulo')::date AS pdate,
      pi.procedure_code,
      pi.procedure_name,
      pi.doctor_name,
      pi.doctor_document,
      pi.doctor_id,
      pi.company_name,
      pi.gross_amount,
      CASE
        WHEN regexp_replace(coalesce(pi.procedure_name,''), '\s+', ' ', 'g') ILIKE '%parecer%' THEN 'parecer'
        WHEN regexp_replace(coalesce(pi.procedure_name,''), '\s+', ' ', 'g') ILIKE '%interconsulta%' THEN 'parecer'
        WHEN regexp_replace(coalesce(pi.procedure_name,''), '\s+', ' ', 'g') ILIKE '%consultoria%' THEN 'parecer'
        WHEN regexp_replace(coalesce(pi.procedure_name,''), '\s+', ' ', 'g') ILIKE '%visita%' THEN 'visita'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10103082' THEN 'parecer'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10103015' THEN 'parecer'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10102019' THEN 'visita'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10102027' THEN 'visita'
        ELSE NULL
      END AS item_kind
    FROM public.payment_items pi
    WHERE pi.hospital_id = v_hospital
      AND pi.procedure_date IS NOT NULL
      AND (pi.procedure_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start AND p_end
  ),
  scoped AS (
    SELECT * FROM eligible e
    WHERE e.item_kind IS NOT NULL
      AND (
        p_item_scope = 'both'
        OR (p_item_scope = 'visita'  AND e.item_kind = 'visita')
        OR (p_item_scope = 'parecer' AND e.item_kind = 'parecer')
      )
  ),
  with_doc AS (
    SELECT
      s.*,
      COALESCE(d.id::text, s.doctor_document, lower(unaccent(btrim(coalesce(s.doctor_name,''))))) AS doc_key,
      COALESCE(d.full_name, s.doctor_name) AS d_name,
      d.specialties AS d_specs
    FROM scoped s
    LEFT JOIN public.doctors d
      ON  d.id = s.doctor_id
       OR (s.doctor_document IS NOT NULL AND btrim(s.doctor_document) = btrim(coalesce(d.crm,'')))
       OR (s.doctor_name IS NOT NULL AND lower(unaccent(btrim(s.doctor_name))) = lower(unaccent(btrim(coalesce(d.full_name,'')))))
  ),
  spec_resolved AS (
    -- 1 linha por item, com especialidade "principal" ou "any" (concatenada)
    SELECT
      w.*,
      COALESCE(
        (
          SELECT string_agg(initcap(lower(unaccent(btrim(sp)))), ' / ' ORDER BY ord)
          FROM unnest(coalesce(w.d_specs, ARRAY[]::text[])) WITH ORDINALITY AS t(sp, ord)
          CROSS JOIN excl
          WHERE sp IS NOT NULL
            AND lower(unaccent(btrim(sp))) <> ALL (excl.specs)
            AND (p_specialty_mode = 'any' OR ord = 1)
        ),
        '(sem especialidade)'
      ) AS spec_label,
      COALESCE(
        (
          SELECT lower(unaccent(btrim(sp)))
          FROM unnest(coalesce(w.d_specs, ARRAY[]::text[])) WITH ORDINALITY AS t(sp, ord)
          CROSS JOIN excl
          WHERE sp IS NOT NULL
            AND lower(unaccent(btrim(sp))) <> ALL (excl.specs)
            AND ord = 1
          LIMIT 1
        ),
        'sem_especialidade'
      ) AS spec_primary_norm
    FROM with_doc w
  ),
  grouped AS (
    -- Chave = atendimento (ou paciente se sem atend) + data + tipo (visita/parecer)
    SELECT
      COALESCE(nullif(btrim(attendance_number),''), 'PAC:'||patient_key) AS group_key,
      max(attendance_number)  AS attendance_number,
      max(patient_name)       AS patient_name,
      max(patient_key)        AS patient_key,
      pdate,
      item_kind,
      count(*)                                     AS row_ct,
      count(DISTINCT doc_key)                      AS distinct_doctors,
      count(DISTINCT spec_primary_norm)            AS distinct_specs,
      array_agg(DISTINCT d_name)      FILTER (WHERE d_name IS NOT NULL)      AS doctors,
      array_agg(DISTINCT spec_label)  FILTER (WHERE spec_label IS NOT NULL)  AS specs_display,
      array_agg(DISTINCT spec_primary_norm) FILTER (WHERE spec_primary_norm IS NOT NULL) AS specs_norm,
      array_agg(DISTINCT payment_id)                                          AS payment_ids,
      sum(gross_amount)                                                        AS total_gross
    FROM spec_resolved
    GROUP BY COALESCE(nullif(btrim(attendance_number),''), 'PAC:'||patient_key), pdate, item_kind
  ),
  qualifying AS (
    SELECT * FROM grouped WHERE distinct_doctors >= p_min_distinct
  ),
  by_combo AS (
    SELECT
      (SELECT string_agg(x, ' + ' ORDER BY x) FROM unnest(specs_display) x) AS combo_label,
      (SELECT string_agg(x, '|' ORDER BY x) FROM unnest(specs_norm) x) AS combo_key,
      count(DISTINCT patient_key)::int AS patients,
      count(DISTINCT (group_key||'#'||pdate))::int AS days,
      count(DISTINCT group_key)::int AS attendances,
      sum(row_ct)::int AS items,
      max(pdate) AS last_day
    FROM qualifying
    GROUP BY 1, 2
    ORDER BY 3 DESC, 4 DESC
    LIMIT 200
  ),
  by_pat AS (
    SELECT
      patient_key,
      max(patient_name) AS patient_name,
      count(DISTINCT pdate)::int AS days,
      count(DISTINCT group_key)::int AS attendances,
      (
        SELECT array_agg(DISTINCT s ORDER BY s)
        FROM unnest(array_agg(specs_display)) AS arr(x)
        CROSS JOIN unnest(arr.x) AS s
      ) AS specialties,
      max(pdate) AS last_day
    FROM qualifying
    GROUP BY patient_key
    ORDER BY 3 DESC, 4 DESC
    LIMIT 100
  ),
  by_att AS (
    SELECT
      pdate,
      patient_name,
      ARRAY[attendance_number] AS attendances,
      doctors,
      specs_display AS specialties,
      payment_ids,
      total_gross,
      row_ct AS items,
      distinct_doctors AS doctors_count,
      item_kind
    FROM qualifying
    ORDER BY pdate DESC, patient_name
    LIMIT 500
  ),
  totals AS (
    SELECT
      count(DISTINCT patient_key)::int AS patients,
      count(DISTINCT (group_key||'#'||pdate))::int AS days,
      count(DISTINCT group_key)::int AS attendances,
      coalesce(sum(row_ct),0)::int AS items
    FROM qualifying
  )
  SELECT jsonb_build_object(
    'by_specialty_combo', coalesce((SELECT jsonb_agg(to_jsonb(by_combo)) FROM by_combo), '[]'::jsonb),
    'by_patient',         coalesce((SELECT jsonb_agg(to_jsonb(by_pat))   FROM by_pat),   '[]'::jsonb),
    'by_attendance',      coalesce((SELECT jsonb_agg(to_jsonb(by_att))   FROM by_att),   '[]'::jsonb),
    'totals',             coalesce((SELECT to_jsonb(totals) FROM totals), '{}'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_overlap_audit(date, date, text, integer, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_overlap_audit(date, date, text, integer, text, text[]) TO service_role;
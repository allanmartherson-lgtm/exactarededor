
CREATE OR REPLACE FUNCTION public.get_overlap_audit(
  p_start date,
  p_end date,
  p_item_scope text DEFAULT 'both'::text,
  p_min_distinct integer DEFAULT 2,
  p_specialty_mode text DEFAULT 'primary'::text,
  p_excluded_specs text[] DEFAULT ARRAY['infectologia'::text]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
      pi.specialty AS item_specialty,
      pi.gross_amount,
      CASE
        WHEN pi.procedure_name ILIKE '%parecer%' THEN 'parecer'
        WHEN pi.procedure_name ILIKE '%interconsulta%' THEN 'parecer'
        WHEN pi.procedure_name ILIKE '%consultoria%' THEN 'parecer'
        WHEN pi.procedure_name ILIKE '%visita%' THEN 'visita'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10103082' THEN 'parecer'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10103015' THEN 'parecer'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10102019' THEN 'visita'
        WHEN regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') = '10102027' THEN 'visita'
        ELSE NULL
      END AS item_kind
    FROM public.payment_items pi
    WHERE pi.hospital_id = v_hospital
      AND pi.is_cancelled = false
      AND pi.procedure_date IS NOT NULL
      AND (pi.procedure_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start AND p_end
      AND (
        pi.procedure_name ILIKE '%parecer%'
        OR pi.procedure_name ILIKE '%interconsulta%'
        OR pi.procedure_name ILIKE '%consultoria%'
        OR pi.procedure_name ILIKE '%visita%'
        OR regexp_replace(coalesce(pi.procedure_code,''), '\D', '', 'g') IN
             ('10103082','10103015','10102019','10102027')
      )
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
  -- Chaves distintas para lookup de médicos — evita LATERAL por linha.
  doc_keys AS (
    SELECT DISTINCT
      s.doctor_id,
      s.doctor_document,
      lower(unaccent(btrim(coalesce(s.doctor_name,'')))) AS name_norm
    FROM scoped s
    WHERE s.item_specialty IS NULL OR btrim(s.item_specialty) = ''
  ),
  -- Match por id (indexado).
  doc_by_id AS (
    SELECT dk.doctor_id, dk.doctor_document, dk.name_norm,
           d.full_name AS d_name, d.specialties AS d_specs
    FROM doc_keys dk
    JOIN public.doctors d ON d.id = dk.doctor_id
    WHERE dk.doctor_id IS NOT NULL
  ),
  -- Match por documento (crm).
  doc_by_doc AS (
    SELECT dk.doctor_id, dk.doctor_document, dk.name_norm,
           d.full_name AS d_name, d.specialties AS d_specs
    FROM doc_keys dk
    JOIN public.doctors d ON btrim(d.crm) = btrim(dk.doctor_document)
    WHERE dk.doctor_id IS NULL
      AND dk.doctor_document IS NOT NULL
  ),
  -- Match por nome normalizado (usa índice lower(full_name) + unaccent tolera).
  doc_by_name AS (
    SELECT dk.doctor_id, dk.doctor_document, dk.name_norm,
           d.full_name AS d_name, d.specialties AS d_specs
    FROM doc_keys dk
    JOIN public.doctors d
      ON lower(unaccent(btrim(coalesce(d.full_name,'')))) = dk.name_norm
    WHERE dk.doctor_id IS NULL
      AND dk.doctor_document IS NULL
      AND dk.name_norm <> ''
  ),
  doc_lookup AS (
    SELECT DISTINCT ON (doctor_id, doctor_document, name_norm)
      doctor_id, doctor_document, name_norm, d_name, d_specs
    FROM (
      SELECT * FROM doc_by_id
      UNION ALL SELECT * FROM doc_by_doc
      UNION ALL SELECT * FROM doc_by_name
    ) u
    ORDER BY doctor_id, doctor_document, name_norm
  ),
  with_doc AS (
    SELECT
      s.*,
      COALESCE(s.doctor_id::text, s.doctor_document, lower(unaccent(btrim(coalesce(s.doctor_name,''))))) AS doc_key,
      COALESCE(dl.d_name, s.doctor_name) AS d_name,
      -- Especialidade do item vence; senão, especialidades do cadastro.
      CASE
        WHEN s.item_specialty IS NOT NULL AND btrim(s.item_specialty) <> ''
          THEN ARRAY[s.item_specialty]
        ELSE dl.d_specs
      END AS d_specs
    FROM scoped s
    LEFT JOIN doc_lookup dl
      ON (s.doctor_id IS NOT NULL AND dl.doctor_id = s.doctor_id)
      OR (s.doctor_id IS NULL AND s.doctor_document IS NOT NULL
          AND dl.doctor_document = s.doctor_document)
      OR (s.doctor_id IS NULL AND s.doctor_document IS NULL
          AND dl.name_norm = lower(unaccent(btrim(coalesce(s.doctor_name,'')))))
  ),
  spec_resolved AS (
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
  qualifying_specs_flat AS (
    SELECT q.patient_key, s AS spec
    FROM qualifying q
    CROSS JOIN LATERAL unnest(q.specs_display) AS s
  ),
  by_combo AS (
    SELECT
      (SELECT string_agg(x, ' + ' ORDER BY x) FROM unnest(specs_display) x) AS combo_label,
      (SELECT string_agg(x, '|' ORDER BY x) FROM unnest(specs_norm) x) AS combo_key,
      count(DISTINCT patient_key)::int AS patients,
      count(DISTINCT (group_key||'#'||pdate))::int AS days,
      count(DISTINCT group_key)::int AS attendances,
      sum(row_ct)::int AS items,
      max(pdate) AS last_day,
      (array_agg(DISTINCT group_key))[1:5] AS sample_attendances
    FROM qualifying
    GROUP BY 1, 2
    ORDER BY 3 DESC, 4 DESC
    LIMIT 200
  ),
  by_pat AS (
    SELECT
      q.patient_key,
      max(q.patient_name) AS patient_name,
      count(DISTINCT q.pdate)::int AS days,
      count(DISTINCT q.group_key)::int AS attendances,
      (
        SELECT array_agg(DISTINCT f.spec ORDER BY f.spec)
        FROM qualifying_specs_flat f
        WHERE f.patient_key = q.patient_key
      ) AS specialties,
      max(q.pdate) AS last_day
    FROM qualifying q
    GROUP BY q.patient_key
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
$function$;

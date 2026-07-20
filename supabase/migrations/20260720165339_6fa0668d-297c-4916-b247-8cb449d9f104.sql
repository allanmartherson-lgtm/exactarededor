CREATE OR REPLACE FUNCTION public.get_overlap_audit(p_start date, p_end date, p_item_scope text DEFAULT 'both'::text, p_min_distinct integer DEFAULT 2, p_specialty_mode text DEFAULT 'primary'::text, p_excluded_specs text[] DEFAULT ARRAY[]::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
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
      NULLIF(btrim(coalesce(pi.doctor_document,'')), '') AS doctor_document_clean,
      pi.doctor_id,
      pi.company_name,
      pi.gross_amount,
      NULLIF(btrim(coalesce(pi.specialty,'')), '') AS pi_specialty,
      CASE
        WHEN it.code = 'visita' THEN 'visita'
        WHEN it.code ILIKE 'parecer%' THEN 'parecer'
        ELSE NULL
      END AS item_kind
    FROM public.payment_items pi
    JOIN public.item_types it ON it.id = pi.item_type_id
    WHERE pi.hospital_id = v_hospital
      AND pi.procedure_date IS NOT NULL
      AND (pi.procedure_date AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN p_start AND p_end
      -- Escopo: apenas visita/parecer cadastrados no item_type
      AND (it.code = 'visita' OR it.code ILIKE 'parecer%')
      -- Reforço: TUSS deve ser oficial de visita/parecer (ou vazio, quando o Exacta ainda não preencheu).
      -- Evita EEG/ENMG erroneamente marcados como parecer na origem.
      AND (
        coalesce(nullif(btrim(pi.procedure_code),''), '') = ''
        OR regexp_replace(pi.procedure_code, '\D', '', 'g') IN
             ('10102019','10102027','10103015','10103082')
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
  needs_doc AS (
    SELECT DISTINCT
      doctor_id,
      doctor_document_clean,
      lower(unaccent(btrim(coalesce(doctor_name,'')))) AS name_norm
    FROM scoped
    WHERE pi_specialty IS NULL
  ),
  key_resolved AS (
    SELECT
      nd.doctor_id,
      nd.doctor_document_clean,
      nd.name_norm,
      COALESCE(
        nd.doctor_id,
        d_crm.id,
        d_name.id,
        al.doctor_id
      ) AS resolved_doctor_id
    FROM needs_doc nd
    LEFT JOIN public.doctors d_crm
      ON nd.doctor_id IS NULL
     AND nd.doctor_document_clean IS NOT NULL
     AND btrim(d_crm.crm) = nd.doctor_document_clean
    LEFT JOIN public.doctors d_name
      ON nd.doctor_id IS NULL
     AND d_crm.id IS NULL
     AND nd.name_norm <> ''
     AND lower(unaccent(btrim(d_name.full_name))) = nd.name_norm
    LEFT JOIN public.doctor_aliases al
      ON nd.doctor_id IS NULL
     AND d_crm.id IS NULL
     AND d_name.id IS NULL
     AND al.alias_normalized = nd.name_norm
  ),
  with_doc AS (
    SELECT
      s.*,
      CASE
        WHEN s.pi_specialty IS NOT NULL THEN s.doctor_id
        ELSE kr.resolved_doctor_id
      END AS resolved_doctor_id
    FROM scoped s
    LEFT JOIN key_resolved kr
      ON s.pi_specialty IS NULL
     AND kr.doctor_id IS NOT DISTINCT FROM s.doctor_id
     AND kr.doctor_document_clean IS NOT DISTINCT FROM s.doctor_document_clean
     AND kr.name_norm = lower(unaccent(btrim(coalesce(s.doctor_name,''))))
  ),
  with_specs AS (
    SELECT
      w.*,
      COALESCE(w.resolved_doctor_id::text, w.doctor_document_clean, lower(unaccent(btrim(coalesce(w.doctor_name,''))))) AS doc_key,
      COALESCE(d.full_name, w.doctor_name) AS d_name,
      CASE
        WHEN w.pi_specialty IS NOT NULL THEN ARRAY[w.pi_specialty]
        ELSE d.specialties
      END AS d_specs
    FROM with_doc w
    LEFT JOIN public.doctors d ON d.id = w.resolved_doctor_id
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
    FROM with_specs w
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

CREATE OR REPLACE FUNCTION public.get_overlap_audit(
  p_start date,
  p_end date,
  p_item_scope text DEFAULT 'both',           -- 'both' | 'visita' | 'parecer'
  p_min_distinct integer DEFAULT 2,
  p_specialty_mode text DEFAULT 'primary',    -- 'primary' | 'any'
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
    -- Itens de parecer/visita do hospital ativo dentro da janela.
    -- Eligibilidade estrita por TUSS ou nome do procedimento — mesma regra
    -- usada na edge function validate-payment.
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
      AND coalesce(nullif(pi.patient_name,''), NULL) IS NOT NULL
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
    -- Resolve médico e especialidades (fallback CRM -> nome normalizado)
    SELECT
      s.*,
      d.id AS d_id,
      d.full_name AS d_name,
      d.specialties AS d_specs
    FROM scoped s
    LEFT JOIN public.doctors d
      ON  d.id = s.doctor_id
       OR (s.doctor_document IS NOT NULL AND btrim(s.doctor_document) = btrim(coalesce(d.crm,'')))
       OR (s.doctor_name IS NOT NULL AND lower(unaccent(btrim(s.doctor_name))) = lower(unaccent(btrim(coalesce(d.full_name,'')))))
  ),
  spec_expanded AS (
    -- Expande as especialidades do médico segundo o modo (primary/any),
    -- e remove as ignoradas.
    SELECT
      w.*,
      lower(unaccent(btrim(spec))) AS spec_norm
    FROM with_doc w
    CROSS JOIN excl
    LEFT JOIN LATERAL (
      SELECT s AS spec
      FROM unnest(coalesce(w.d_specs, ARRAY[]::text[])) WITH ORDINALITY AS t(s, ord)
      WHERE (p_specialty_mode = 'any' OR ord = 1)
    ) e ON true
    WHERE spec IS NOT NULL
      AND lower(unaccent(btrim(spec))) <> ALL (excl.specs)
  ),
  grouped AS (
    SELECT
      patient_key,
      max(patient_name) AS patient_name,
      pdate,
      count(*) FILTER (WHERE true) AS row_ct,
      count(DISTINCT spec_norm) AS distinct_specs,
      array_agg(DISTINCT spec_norm) FILTER (WHERE spec_norm IS NOT NULL) AS specs_norm,
      array_agg(DISTINCT initcap(spec_norm)) FILTER (WHERE spec_norm IS NOT NULL) AS specs_display,
      array_agg(DISTINCT attendance_number) FILTER (WHERE attendance_number IS NOT NULL) AS attendances,
      array_agg(DISTINCT d_name) FILTER (WHERE d_name IS NOT NULL) AS doctors,
      array_agg(DISTINCT payment_id) AS payment_ids,
      sum(gross_amount) AS total_gross,
      -- guarda 1 id por linha pra sample
      array_agg(id) AS item_ids
    FROM spec_expanded
    GROUP BY patient_key, pdate
  ),
  qualifying AS (
    SELECT * FROM grouped
    WHERE distinct_specs >= p_min_distinct
  ),
  -- ============ CARD 1: combinações de especialidades ============
  combos AS (
    SELECT
      -- combo assinado alfabeticamente pra agrupar independente da ordem
      (SELECT string_agg(x, ' + ' ORDER BY x)
         FROM unnest(specs_display) x) AS combo_label,
      (SELECT string_agg(x, '|' ORDER BY x)
         FROM unnest(specs_norm) x) AS combo_key,
      *
    FROM qualifying
  ),
  by_combo AS (
    SELECT
      combo_label,
      combo_key,
      count(DISTINCT patient_key) AS patients,
      count(*) AS days,
      count(DISTINCT unnested_att) FILTER (WHERE unnested_att IS NOT NULL) AS attendances,
      sum(row_ct) AS items,
      (array_agg(attendances ORDER BY pdate DESC))[1] AS sample_attendances,
      max(pdate) AS last_day
    FROM combos
    LEFT JOIN LATERAL unnest(combos.attendances) AS unnested_att ON true
    GROUP BY combo_label, combo_key
    ORDER BY count(DISTINCT patient_key) DESC, count(*) DESC
    LIMIT 200
  ),
  -- ============ CARD 2: pacientes ============
  by_pat AS (
    SELECT
      patient_key,
      max(patient_name) AS patient_name,
      count(*) AS days,
      count(DISTINCT unnested_att) FILTER (WHERE unnested_att IS NOT NULL) AS attendances,
      (
        SELECT array_agg(DISTINCT s ORDER BY s)
        FROM unnest(array_agg(specs_display)) AS arr(x)
        CROSS JOIN unnest(arr.x) AS s
      ) AS specialties,
      max(pdate) AS last_day
    FROM qualifying
    LEFT JOIN LATERAL unnest(qualifying.attendances) AS unnested_att ON true
    GROUP BY patient_key
    ORDER BY count(*) DESC
    LIMIT 100
  ),
  -- ============ CARD 3: atendimentos (paciente + dia) ============
  by_att AS (
    SELECT
      pdate,
      patient_name,
      attendances,
      doctors,
      specs_display AS specialties,
      payment_ids,
      total_gross,
      row_ct AS items
    FROM qualifying
    ORDER BY pdate DESC, patient_name
    LIMIT 500
  ),
  totals AS (
    SELECT
      count(DISTINCT patient_key)::int AS patients,
      count(*)::int AS days,
      (SELECT count(DISTINCT a)::int
         FROM qualifying q2
         LEFT JOIN LATERAL unnest(q2.attendances) a ON true) AS attendances,
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

-- Índice auxiliar (idempotente) — acelera a janela por hospital + data
CREATE INDEX IF NOT EXISTS payment_items_hospital_procdate_idx
  ON public.payment_items (hospital_id, procedure_date)
  WHERE procedure_date IS NOT NULL;

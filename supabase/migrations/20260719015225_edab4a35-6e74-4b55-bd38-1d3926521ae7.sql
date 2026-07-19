
-- =========================================================
-- Item 2 — RPC: anomalias por VOLUME DE ITENS por padrão
-- =========================================================
CREATE OR REPLACE FUNCTION public.get_pattern_volume_anomalies(
  _threshold_pct numeric DEFAULT 40,
  _min_months int DEFAULT 3,
  _lookback_months int DEFAULT 6
)
RETURNS TABLE (
  pattern_id uuid,
  pattern_label text,
  payment_id uuid,
  payment_reference text,
  competence_month date,
  actual_count bigint,
  expected_avg numeric,
  stddev_count numeric,
  months_seen int,
  deviation_pct numeric,
  z_score numeric,
  direction text,
  severity text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hospital uuid := current_active_hospital();
  v_since date := (date_trunc('month', now()) - make_interval(months => _lookback_months))::date;
  v_current date := date_trunc('month', now())::date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  WITH hist AS (
    SELECT
      p.batch_pattern_id,
      p.id AS payment_id,
      COALESCE(p.items_count, 0)::bigint AS n_items,
      date_trunc('month', p.competence_month)::date AS comp
    FROM public.payments p
    WHERE p.hospital_id = v_hospital
      AND p.batch_pattern_id IS NOT NULL
      AND p.competence_month >= v_since
      AND p.competence_month <  v_current
  ),
  stats AS (
    SELECT
      batch_pattern_id,
      AVG(n_items)::numeric AS avg_n,
      COALESCE(STDDEV_SAMP(n_items),0)::numeric AS sd_n,
      COUNT(DISTINCT comp)::int AS months_seen
    FROM hist
    GROUP BY batch_pattern_id
  ),
  current_batches AS (
    SELECT
      p.id AS payment_id,
      p.reference,
      p.batch_pattern_id,
      COALESCE(p.items_count, 0)::bigint AS n_items,
      date_trunc('month', p.competence_month)::date AS comp
    FROM public.payments p
    WHERE p.hospital_id = v_hospital
      AND p.batch_pattern_id IS NOT NULL
      AND p.competence_month >= v_current
  )
  SELECT
    s.batch_pattern_id AS pattern_id,
    pbp.label AS pattern_label,
    cb.payment_id,
    cb.reference AS payment_reference,
    cb.comp AS competence_month,
    cb.n_items AS actual_count,
    ROUND(s.avg_n, 1) AS expected_avg,
    ROUND(s.sd_n, 1) AS stddev_count,
    s.months_seen,
    CASE WHEN s.avg_n > 0
         THEN ROUND(((cb.n_items - s.avg_n) / s.avg_n) * 100.0, 1)
         ELSE NULL
    END AS deviation_pct,
    CASE WHEN s.sd_n > 0
         THEN ROUND((cb.n_items - s.avg_n) / s.sd_n, 2)
         ELSE NULL
    END AS z_score,
    CASE WHEN cb.n_items >= s.avg_n THEN 'alto' ELSE 'baixo' END AS direction,
    CASE
      WHEN s.avg_n > 0 AND ABS((cb.n_items - s.avg_n) / s.avg_n) * 100.0 >= (_threshold_pct * 1.5) THEN 'alta'
      WHEN s.sd_n > 0 AND ABS((cb.n_items - s.avg_n) / s.sd_n) >= 3 THEN 'alta'
      WHEN s.avg_n > 0 AND ABS((cb.n_items - s.avg_n) / s.avg_n) * 100.0 >= _threshold_pct THEN 'media'
      ELSE 'baixa'
    END AS severity
  FROM current_batches cb
  JOIN stats s ON s.batch_pattern_id = cb.batch_pattern_id
  JOIN public.payment_batch_patterns pbp ON pbp.id = cb.batch_pattern_id
  WHERE s.months_seen >= _min_months
    AND s.avg_n > 0
    AND (
      ABS((cb.n_items - s.avg_n) / NULLIF(s.avg_n,0)) * 100.0 >= _threshold_pct
      OR (s.sd_n > 0 AND ABS((cb.n_items - s.avg_n) / s.sd_n) >= 2)
    )
  ORDER BY
    CASE WHEN s.avg_n > 0 THEN ABS((cb.n_items - s.avg_n) / s.avg_n) ELSE 0 END DESC
  LIMIT 100;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pattern_volume_anomalies(numeric,int,int) TO authenticated;

-- =========================================================
-- Item 4 — Estende list_payments com filtros por padrão
-- =========================================================
CREATE OR REPLACE FUNCTION public.list_payments(
  _filters jsonb DEFAULT '{}'::jsonb,
  _limit integer DEFAULT 50,
  _offset integer DEFAULT 0,
  _sort text DEFAULT 'priority'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_statuses text[];
  v_payment_types text[];
  v_payment_tracks text[];
  v_created_by_ids uuid[];
  v_company_ids uuid[];
  v_doctor_ids uuid[];
  v_pool_ids uuid[];
  v_import_modes text[];
  v_item_type_ids uuid[];
  v_batch_pattern_ids uuid[];
  v_only_unlinked_pattern boolean;
  v_only_empty boolean;
  v_competence_from date;
  v_competence_to date;
  v_search text;
  v_only_overdue boolean;
  v_only_open_q boolean;
  v_only_divergence boolean;
  v_only_items_error boolean;
  v_with_questions text;
  v_assigned_to uuid;
  v_has_proposed_glosas boolean;
  v_has_applied_debits  boolean;
  v_has_applied_credits boolean;
  v_has_alerts          boolean;
  v_order text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  v_statuses        := CASE WHEN jsonb_typeof(_filters->'statuses') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'statuses')) END;
  v_payment_types   := CASE WHEN jsonb_typeof(_filters->'payment_types') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'payment_types')) END;
  v_payment_tracks  := CASE WHEN jsonb_typeof(_filters->'payment_tracks') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'payment_tracks')) END;
  v_created_by_ids  := CASE WHEN jsonb_typeof(_filters->'created_by_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'created_by_ids'))::uuid) END;
  v_company_ids     := CASE WHEN jsonb_typeof(_filters->'company_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'company_ids'))::uuid) END;
  v_doctor_ids      := CASE WHEN jsonb_typeof(_filters->'doctor_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'doctor_ids'))::uuid) END;
  v_pool_ids        := CASE WHEN jsonb_typeof(_filters->'pool_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'pool_ids'))::uuid) END;
  v_import_modes    := CASE WHEN jsonb_typeof(_filters->'import_modes') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'import_modes')) END;
  v_item_type_ids   := CASE WHEN jsonb_typeof(_filters->'item_type_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'item_type_ids'))::uuid) END;
  v_batch_pattern_ids := CASE WHEN jsonb_typeof(_filters->'batch_pattern_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'batch_pattern_ids'))::uuid) END;
  v_only_unlinked_pattern := COALESCE((_filters->>'only_unlinked_pattern')::boolean, false);
  v_only_empty      := COALESCE((_filters->>'only_empty')::boolean, false);
  v_competence_from := NULLIF(_filters->>'competence_from','')::date;
  v_competence_to   := NULLIF(_filters->>'competence_to','')::date;
  v_search          := NULLIF(trim(_filters->>'search'),'');
  v_only_overdue    := COALESCE((_filters->>'only_overdue')::boolean, false);
  v_only_open_q     := COALESCE((_filters->>'only_open_questions')::boolean, false);
  v_only_divergence := COALESCE((_filters->>'only_divergence')::boolean, false);
  v_only_items_error:= COALESCE((_filters->>'only_items_error')::boolean, false);
  v_with_questions  := NULLIF(_filters->>'with_questions','');
  v_assigned_to     := NULLIF(_filters->>'assigned_to','')::uuid;
  v_has_proposed_glosas := COALESCE((_filters->>'has_proposed_glosas')::boolean, false);
  v_has_applied_debits  := COALESCE((_filters->>'has_applied_debits')::boolean, false);
  v_has_applied_credits := COALESCE((_filters->>'has_applied_credits')::boolean, false);
  v_has_alerts          := COALESCE((_filters->>'has_alerts')::boolean, false);

  v_order := CASE _sort
    WHEN 'created'    THEN 'p.created_at DESC'
    WHEN 'competence' THEN 'p.competence_month DESC NULLS LAST'
    WHEN 'amount'     THEN 'p.total_amount DESC'
    WHEN 'status'     THEN 'p.status::text, p.priority_score DESC'
    ELSE 'p.priority_score DESC NULLS LAST, p.created_at DESC'
  END;

  CREATE TEMP TABLE _filtered ON COMMIT DROP AS
  SELECT p.id
  FROM public.payments p
  LEFT JOIN public.mv_payments_flags f ON f.payment_id = p.id
  WHERE
    p.hospital_id = current_active_hospital()
    AND (v_statuses IS NULL
       OR p.status::text = ANY(v_statuses)
       OR EXISTS (
            SELECT 1 FROM public.payment_company_groups g
            WHERE g.payment_id = p.id AND g.status::text = ANY(v_statuses)
       ))
    AND (v_payment_types IS NULL OR p.payment_type = ANY(v_payment_types))
    AND (v_payment_tracks IS NULL OR p.payment_track::text = ANY(v_payment_tracks))
    AND (v_created_by_ids IS NULL OR p.created_by = ANY(v_created_by_ids))
    AND (v_pool_ids IS NULL OR p.pool_id = ANY(v_pool_ids))
    AND (v_import_modes IS NULL OR COALESCE(p.import_mode, 'normal') = ANY(v_import_modes))
    AND (v_batch_pattern_ids IS NULL OR p.batch_pattern_id = ANY(v_batch_pattern_ids))
    AND (NOT v_only_unlinked_pattern OR p.batch_pattern_id IS NULL)
    AND (NOT v_only_empty OR COALESCE(p.items_count, 0) = 0)
    AND (v_competence_from IS NULL OR p.competence_month >= v_competence_from)
    AND (v_competence_to   IS NULL OR p.competence_month <= v_competence_to)
    AND (NOT v_only_overdue     OR COALESCE(f.is_overdue,false))
    AND (NOT v_only_open_q      OR COALESCE(f.has_open_question,false))
    AND (NOT v_only_divergence  OR COALESCE(f.has_divergence,false))
    AND (NOT v_only_items_error OR COALESCE(f.has_items_error,false))
    AND (NOT v_has_alerts       OR COALESCE(f.has_divergence,false) OR COALESCE(f.has_items_error,false))
    AND (v_with_questions IS NULL
         OR (v_with_questions = 'with'    AND COALESCE(f.has_open_question,false))
         OR (v_with_questions = 'without' AND NOT COALESCE(f.has_open_question,false)))
    AND (v_company_ids IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_company_groups g
          WHERE g.payment_id = p.id AND g.company_id = ANY(v_company_ids)))
    AND (v_doctor_ids IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = p.id AND pi.doctor_id = ANY(v_doctor_ids)))
    AND (v_item_type_ids IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = p.id AND pi.item_type_id = ANY(v_item_type_ids)))
    AND (v_assigned_to IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_assignments pa
          WHERE pa.payment_id = p.id AND pa.analyst_id = v_assigned_to))
    AND (NOT v_has_proposed_glosas OR EXISTS (
          SELECT 1 FROM public.company_adjustment_applications caa
          WHERE caa.payment_id = p.id AND caa.status = 'proposto'))
    AND (NOT v_has_applied_debits OR EXISTS (
          SELECT 1 FROM public.company_adjustment_applications caa
          JOIN public.company_financial_adjustments cfa ON cfa.id = caa.adjustment_id
          WHERE caa.payment_id = p.id
            AND caa.status = 'confirmado'
            AND cfa.tipo IN ('debito','glosa_parcelada','complemento_retroativo','acordo')))
    AND (NOT v_has_applied_credits OR EXISTS (
          SELECT 1 FROM public.company_adjustment_applications caa
          JOIN public.company_financial_adjustments cfa ON cfa.id = caa.adjustment_id
          WHERE caa.payment_id = p.id
            AND caa.status = 'confirmado'
            AND cfa.tipo = 'credito'))
    AND (v_search IS NULL OR (
          p.reference ILIKE '%'||v_search||'%'
          OR EXISTS (SELECT 1 FROM public.payment_company_groups g
                     JOIN public.companies c ON c.id = g.company_id
                     WHERE g.payment_id = p.id AND c.name ILIKE '%'||v_search||'%')
          OR EXISTS (SELECT 1 FROM public.payment_items pi
                     WHERE pi.payment_id = p.id
                       AND (pi.doctor_name ILIKE '%'||v_search||'%'
                            OR pi.attendance_number ILIKE '%'||v_search||'%'
                            OR pi.procedure_code ILIKE '%'||v_search||'%'
                            OR pi.procedure_name ILIKE '%'||v_search||'%'
                            OR pi.description ILIKE '%'||v_search||'%'))
        ));

  SELECT count(*) INTO v_total FROM _filtered;

  EXECUTE format($f$
    SELECT COALESCE(jsonb_agg(row), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', p.id,
        'reference', p.reference,
        'description', p.description,
        'status', p.status,
        'total_amount', p.total_amount,
        'bruto_total', p.bruto_total,
        'liquido_total', p.liquido_total,
        'items_count', p.items_count,
        'competence_month', p.competence_month,
        'competence_months', p.competence_months,
        'payment_due_date', p.payment_due_date,
        'payment_type', p.payment_type,
        'payment_kind', p.payment_kind,
        'payment_track', p.payment_track,
        'cost_center_code', p.cost_center_code,
        'sectors', p.sectors,
        'specialties', p.specialties,
        'analysis_mode', p.analysis_mode,
        'confeccao_status', p.confeccao_status,
        'import_mode', p.import_mode,
        'pool_id', p.pool_id,
        'batch_pattern_id', p.batch_pattern_id,
        'created_by', p.created_by,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'priority_score', p.priority_score,
        'hospital_id', p.hospital_id,
        'has_open_question', COALESCE(f.has_open_question, false),
        'has_divergence', COALESCE(f.has_divergence, false),
        'has_items_error', COALESCE(f.has_items_error, false),
        'is_overdue', COALESCE(f.is_overdue, false)
      ) AS row
      FROM public.payments p
      JOIN _filtered ff ON ff.id = p.id
      LEFT JOIN public.mv_payments_flags f ON f.payment_id = p.id
      ORDER BY %s
      LIMIT %s OFFSET %s
    ) s
  $f$, v_order, _limit, _offset) INTO v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

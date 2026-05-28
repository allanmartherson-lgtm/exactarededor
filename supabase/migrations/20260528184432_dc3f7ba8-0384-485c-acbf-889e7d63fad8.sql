CREATE OR REPLACE FUNCTION public.list_payments(_filters jsonb DEFAULT '{}'::jsonb, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _sort text DEFAULT 'priority'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_statuses text[];
  v_payment_types text[];
  v_created_by_ids uuid[];
  v_company_ids uuid[];
  v_doctor_ids uuid[];
  v_competence_from date;
  v_competence_to date;
  v_search text;
  v_only_overdue boolean;
  v_only_open_q boolean;
  v_only_divergence boolean;
  v_only_items_error boolean;
  v_with_questions text; -- 'with' | 'without' | null
  v_assigned_to uuid;
  v_order text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '28000';
  END IF;

  v_statuses        := CASE WHEN jsonb_typeof(_filters->'statuses') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'statuses')) END;
  v_payment_types   := CASE WHEN jsonb_typeof(_filters->'payment_types') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'payment_types')) END;
  v_created_by_ids  := CASE WHEN jsonb_typeof(_filters->'created_by_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'created_by_ids'))::uuid) END;
  v_company_ids     := CASE WHEN jsonb_typeof(_filters->'company_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'company_ids'))::uuid) END;
  v_doctor_ids      := CASE WHEN jsonb_typeof(_filters->'doctor_ids') = 'array'
                        THEN ARRAY(SELECT (jsonb_array_elements_text(_filters->'doctor_ids'))::uuid) END;
  v_competence_from := NULLIF(_filters->>'competence_from','')::date;
  v_competence_to   := NULLIF(_filters->>'competence_to','')::date;
  v_search          := NULLIF(trim(_filters->>'search'),'');
  v_only_overdue    := COALESCE((_filters->>'only_overdue')::boolean, false);
  v_only_open_q     := COALESCE((_filters->>'only_open_questions')::boolean, false);
  v_only_divergence := COALESCE((_filters->>'only_divergence')::boolean, false);
  v_only_items_error:= COALESCE((_filters->>'only_items_error')::boolean, false);
  v_with_questions  := NULLIF(_filters->>'with_questions','');
  v_assigned_to     := NULLIF(_filters->>'assigned_to','')::uuid;

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
    (v_statuses IS NULL OR p.status::text = ANY(v_statuses))
    AND (v_payment_types IS NULL OR p.payment_type = ANY(v_payment_types))
    AND (v_created_by_ids IS NULL OR p.created_by = ANY(v_created_by_ids))
    AND (v_competence_from IS NULL OR p.competence_month >= v_competence_from)
    AND (v_competence_to   IS NULL OR p.competence_month <= v_competence_to)
    AND (NOT v_only_overdue     OR COALESCE(f.is_overdue,false))
    AND (NOT v_only_open_q      OR COALESCE(f.has_open_question,false))
    AND (NOT v_only_divergence  OR COALESCE(f.has_divergence,false))
    AND (NOT v_only_items_error OR COALESCE(f.has_items_error,false))
    AND (v_with_questions IS NULL
         OR (v_with_questions = 'with'    AND COALESCE(f.has_open_question,false))
         OR (v_with_questions = 'without' AND NOT COALESCE(f.has_open_question,false)))
    AND (v_company_ids IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_company_groups g
          WHERE g.payment_id = p.id AND g.company_id = ANY(v_company_ids)))
    AND (v_doctor_ids IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_items pi
          WHERE pi.payment_id = p.id AND pi.doctor_id = ANY(v_doctor_ids)))
    AND (v_assigned_to IS NULL OR EXISTS (
          SELECT 1 FROM public.payment_assignments pa
          WHERE pa.payment_id = p.id AND pa.analyst_id = v_assigned_to))
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
        'sectors', p.sectors,
        'specialties', p.specialties,
        'created_at', p.created_at,
        'updated_at', p.updated_at,
        'approved_at', p.approved_at,
        'created_by', p.created_by,
        'processing_diagnostics', p.processing_diagnostics,
        'processing_timeout_occurred', p.processing_timeout_occurred,
        'priority_score', p.priority_score,
        'has_open_question', COALESCE(f.has_open_question,false),
        'has_divergence',    COALESCE(f.has_divergence,false),
        'has_items_error',   COALESCE(f.has_items_error,false),
        'is_overdue',        COALESCE(f.is_overdue,false)
      ) AS row
      FROM _filtered fl
      JOIN public.payments p ON p.id = fl.id
      LEFT JOIN public.mv_payments_flags f ON f.payment_id = p.id
      ORDER BY %s
      LIMIT %s OFFSET %s
    ) t
  $f$, v_order, _limit, _offset) INTO v_rows;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$function$;
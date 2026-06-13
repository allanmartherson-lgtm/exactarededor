-- Versiona as definições atuais de 11 RPCs com filtro de escopo de hospital.
-- Idempotente: extraído via pg_get_functiondef. Não alterar manualmente.

-- ============================================================
-- public.list_payments(jsonb, integer, integer, text)
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_payments(_filters jsonb DEFAULT '{}'::jsonb, _limit integer DEFAULT 50, _offset integer DEFAULT 0, _sort text DEFAULT 'priority'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_competence_from date;
  v_competence_to date;
  v_search text;
  v_only_overdue boolean;
  v_only_open_q boolean;
  v_only_divergence boolean;
  v_only_items_error boolean;
  v_with_questions text;
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
  v_payment_tracks  := CASE WHEN jsonb_typeof(_filters->'payment_tracks') = 'array'
                        THEN ARRAY(SELECT jsonb_array_elements_text(_filters->'payment_tracks')) END;
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
        'payment_track', p.payment_track,
        'cost_center_code', p.cost_center_code,
        'sectors', p.sectors,
        'specialties', p.specialties,
        'analysis_mode', p.analysis_mode,
        'confeccao_status', p.confeccao_status,
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
$function$

;

-- ============================================================
-- public.payments_kpis(jsonb)
-- ============================================================
CREATE OR REPLACE FUNCTION public.payments_kpis(_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_statuses text[]    := NULLIF(ARRAY(SELECT jsonb_array_elements_text(_filters->'statuses')), ARRAY[]::text[]);
  v_types text[]       := NULLIF(ARRAY(SELECT jsonb_array_elements_text(_filters->'payment_types')), ARRAY[]::text[]);
  v_created uuid[]     := NULLIF(ARRAY(SELECT (jsonb_array_elements_text(_filters->'created_by_ids'))::uuid), ARRAY[]::uuid[]);
  v_companies uuid[]   := NULLIF(ARRAY(SELECT (jsonb_array_elements_text(_filters->'company_ids'))::uuid), ARRAY[]::uuid[]);
  v_doctors uuid[]     := NULLIF(ARRAY(SELECT (jsonb_array_elements_text(_filters->'doctor_ids'))::uuid), ARRAY[]::uuid[]);
  v_comp_from date     := NULLIF(_filters->>'competence_from','')::date;
  v_comp_to date       := NULLIF(_filters->>'competence_to','')::date;
  v_search text        := NULLIF(_filters->>'search','');
  v_only_overdue bool  := COALESCE((_filters->>'only_overdue')::bool, false);
  v_only_open_q bool   := COALESCE((_filters->>'only_open_questions')::bool, false);
  v_only_div bool      := COALESCE((_filters->>'only_divergence')::bool, false);
  v_with_q text        := NULLIF(_filters->>'with_questions','');
  result jsonb;
BEGIN
  WITH base AS (
    SELECT p.*
    FROM payments p
    LEFT JOIN mv_payments_flags f ON f.payment_id = p.id
    WHERE p.hospital_id = current_active_hospital()
      AND (v_statuses IS NULL OR p.status::text = ANY(v_statuses))
      AND (v_types IS NULL OR p.payment_type::text = ANY(v_types))
      AND (v_created IS NULL OR p.created_by = ANY(v_created))
      AND (v_comp_from IS NULL OR (p.competence_month >= v_comp_from OR EXISTS (
        SELECT 1 FROM unnest(p.competence_months) cm WHERE cm::date >= v_comp_from
      )))
      AND (v_comp_to IS NULL OR (p.competence_month <= v_comp_to OR EXISTS (
        SELECT 1 FROM unnest(p.competence_months) cm WHERE cm::date <= v_comp_to
      )))
      AND (v_companies IS NULL OR EXISTS (
        SELECT 1 FROM payment_company_groups g WHERE g.payment_id = p.id AND g.company_id = ANY(v_companies)
      ))
      AND (v_doctors IS NULL OR EXISTS (
        SELECT 1 FROM payment_items pi WHERE pi.payment_id = p.id AND pi.doctor_id = ANY(v_doctors)
      ))
      AND (v_search IS NULL OR p.reference ILIKE '%'||v_search||'%' OR p.reference % v_search)
      AND (NOT v_only_overdue OR COALESCE(f.is_overdue, false))
      AND (NOT v_only_open_q OR COALESCE(f.has_open_question, false))
      AND (NOT v_only_div OR COALESCE(f.has_divergence, false))
      AND (v_with_q IS NULL OR v_with_q = 'all'
           OR (v_with_q = 'with' AND COALESCE(f.has_open_question, false))
           OR (v_with_q = 'without' AND NOT COALESCE(f.has_open_question, false)))
  ),
  open_base AS (
    SELECT * FROM base
    WHERE status::text NOT IN ('pago','rejeitado','cancelado','arquivado')
  ),
  comp_counts AS (
    SELECT to_char(COALESCE(competence_month, competence_months[1])::date, 'YYYY-MM') AS c, count(*) n
    FROM base
    WHERE competence_month IS NOT NULL OR (competence_months IS NOT NULL AND array_length(competence_months,1) > 0)
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'totalOpen', COALESCE((SELECT sum(total_amount) FROM open_base), 0),
    'activeTotal', (SELECT count(*) FROM open_base),
    'waitingValidation', (SELECT count(*) FROM base WHERE status::text IN (
        'revisao_analista','concluida_analista','aguardando_validacao','devolvido_analista'
    )),
    'waitingApproval', (SELECT count(*) FROM base WHERE status::text IN (
        'aguardando_aprovacao','aprovado_em_revisao','aprovado_parcial'
    )),
    'postApproval', (SELECT count(*) FROM base WHERE status::text IN (
        'aprovado','aprovado_com_ressalva','revisao_pos_aprovacao',
        'pedido_nf_enviado','nf_recebida','nf_questionada','nf_divergente','nf_conciliada'
    )),
    'delayed', (SELECT count(*) FROM base b
                LEFT JOIN mv_payments_flags f ON f.payment_id = b.id
                WHERE COALESCE(f.is_overdue, false)),
    'competence', (SELECT c FROM comp_counts)
  ) INTO result;

  RETURN result;
END;
$function$

;

-- ============================================================
-- public.payments_global_stats()
-- ============================================================
CREATE OR REPLACE FUNCTION public.payments_global_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  archived_count bigint;
  competences text[];
  analyst_ids uuid[];
  analysts jsonb;
BEGIN
  SELECT count(*) INTO archived_count
  FROM payments
  WHERE status IN ('lancado','pago','rejeitado','cancelado','arquivado')
    AND hospital_id = current_active_hospital();

  SELECT array_agg(DISTINCT to_char(c, 'YYYY-MM') ORDER BY to_char(c, 'YYYY-MM') DESC)
  INTO competences
  FROM (
    SELECT competence_month::date AS c FROM payments
      WHERE competence_month IS NOT NULL
        AND hospital_id = current_active_hospital()
    UNION ALL
    SELECT unnest(competence_months)::date AS c FROM payments
      WHERE competence_months IS NOT NULL
        AND hospital_id = current_active_hospital()
  ) t
  WHERE c IS NOT NULL;

  SELECT array_agg(DISTINCT created_by) INTO analyst_ids
  FROM payments WHERE created_by IS NOT NULL
    AND hospital_id = current_active_hospital();

  SELECT jsonb_object_agg(p.id::text, COALESCE(p.full_name, p.email, '—'))
  INTO analysts
  FROM profiles p
  WHERE p.id = ANY(COALESCE(analyst_ids, ARRAY[]::uuid[]));

  RETURN jsonb_build_object(
    'archived_count', archived_count,
    'competences', COALESCE(to_jsonb(competences), '[]'::jsonb),
    'analysts', COALESCE(analysts, '{}'::jsonb)
  );
END;
$function$

;

-- ============================================================
-- public.get_open_position(uuid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_open_position(p_company_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(payment_id uuid, reference text, status text, company_id uuid, company_name text, competencia date, bruto numeric, liquido numeric, age_days integer, aging_bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id, p.reference, p.status::text,
    pcf.company_id, c.name,
    date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date,
    COALESCE(pcf.bruto,0),
    COALESCE(pcf.bruto - pcf.debitos + pcf.creditos - pcf.glosas + pcf.pool, 0),
    EXTRACT(DAY FROM (now() - p.created_at))::int,
    CASE
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 15 THEN '0-15'
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 30 THEN '16-30'
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 60 THEN '31-60'
      ELSE '60+'
    END
  FROM public.payments p
  LEFT JOIN public.payment_company_financials pcf ON pcf.payment_id = p.id
  LEFT JOIN public.companies c ON c.id = pcf.company_id
  WHERE p.status::text NOT IN ('pago','cancelado','rejeitado','arquivado')
    AND p.hospital_id = current_active_hospital()
    AND (p_company_id IS NULL OR pcf.company_id = p_company_id)
  ORDER BY 9 DESC NULLS LAST;
$function$

;

-- ============================================================
-- public.get_open_position(uuid, text)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_open_position(p_company_id uuid DEFAULT NULL::uuid, p_track text DEFAULT NULL::text)
 RETURNS TABLE(payment_id uuid, reference text, status text, company_id uuid, company_name text, competencia date, bruto numeric, liquido numeric, age_days integer, aging_bucket text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    p.id, p.reference, p.status::text,
    pcf.company_id, c.name,
    date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date,
    COALESCE(pcf.bruto,0),
    COALESCE(pcf.bruto - pcf.debitos + pcf.creditos - pcf.glosas + pcf.pool, 0),
    EXTRACT(DAY FROM (now() - p.created_at))::int,
    CASE
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 15 THEN '0-15'
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 30 THEN '16-30'
      WHEN EXTRACT(DAY FROM (now() - p.created_at)) <= 60 THEN '31-60'
      ELSE '60+'
    END
  FROM public.payments p
  LEFT JOIN public.payment_company_financials pcf ON pcf.payment_id = p.id
  LEFT JOIN public.companies c ON c.id = pcf.company_id
  WHERE p.status::text NOT IN ('pago','cancelado','rejeitado','arquivado')
    AND p.hospital_id = current_active_hospital()
    AND (p_company_id IS NULL OR pcf.company_id = p_company_id)
    AND (
      p_track IS NULL
      OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
      OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
    )
  ORDER BY 9 DESC NULLS LAST;
$function$

;

-- ============================================================
-- public.get_payment_pivot(date, integer, text, text)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_payment_pivot(p_current_month date, p_months_back integer, p_grouping text, p_secondary text DEFAULT NULL::text)
 RETURNS TABLE(group_key text, parent_key text, month_bucket date, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start date;
  v_end   date;
begin
  SET LOCAL statement_timeout = '30s';

  v_start := (date_trunc('month', p_current_month)::date) - ((greatest(p_months_back,1) - 1) || ' month')::interval;
  v_end   := (date_trunc('month', p_current_month)::date) + interval '1 month';

  return query
  with base as (
    select
      pi.gross_amount,
      pi.doctor_name,
      pi.company_name,
      p.cost_center_code,
      date_trunc('month', p.competence_month::date)::date as m,
      coalesce(
        nullif(btrim(pi.specialty), ''),
        (
          select (d.specialties)[1]
          from public.doctors d
          where public.normalize_alias(d.full_name) = public.normalize_alias(pi.doctor_name)
            and d.specialties is not null
            and array_length(d.specialties, 1) >= 1
          limit 1
        ),
        (
          select (d2.specialties)[1]
          from public.doctor_aliases da
          join public.doctors d2 on d2.id = da.doctor_id
          where da.alias_normalized = public.normalize_alias(pi.doctor_name)
            and d2.specialties is not null
            and array_length(d2.specialties, 1) >= 1
          limit 1
        ),
        '(sem especialidade)'
      ) as especialidade
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    where p.competence_month is not null
      and p.competence_month::date >= v_start
      and p.competence_month::date <  v_end
      and p.hospital_id = current_active_hospital()
  ),
  tagged as (
    select
      case p_grouping
        when 'especialidade' then especialidade
        when 'empresa'       then coalesce(company_name, '(sem empresa)')
        when 'medico'        then coalesce(doctor_name, '(sem médico)')
        when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
        else '(?)'
      end as g1,
      case p_secondary
        when 'especialidade' then especialidade
        when 'empresa'       then coalesce(company_name, '(sem empresa)')
        when 'medico'        then coalesce(doctor_name, '(sem médico)')
        when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
        else null
      end as g2,
      m,
      gross_amount
    from base
  )
  select g1, null::text, m, sum(gross_amount)::numeric
  from tagged
  group by g1, m
  union all
  select g2, g1, m, sum(gross_amount)::numeric
  from tagged
  where p_secondary is not null and g2 is not null
  group by g2, g1, m;
end;
$function$

;

-- ============================================================
-- public.get_payment_pivot(date, integer, text, text, uuid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_payment_pivot(p_current_month date, p_months_back integer, p_grouping text, p_secondary text DEFAULT NULL::text, p_payment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(group_key text, parent_key text, month_bucket date, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start date;
  v_end   date;
  v_curr  date;
  v_cc    text;
begin
  SET LOCAL statement_timeout = '30s';

  v_curr  := date_trunc('month', p_current_month)::date;
  v_start := v_curr - ((greatest(p_months_back,1) - 1) || ' month')::interval;
  v_end   := v_curr + interval '1 month';

  if p_payment_id is not null then
    select cost_center_code into v_cc
    from public.payments
    where id = p_payment_id;
  end if;

  return query
  with raw as (
    select
      pi.id as item_id,
      pi.doctor_name,
      pi.company_name,
      pi.company_id,
      pi.payment_id,
      pi.gross_amount,
      nullif(btrim(pi.specialty), '') as item_specialty,
      public.normalize_alias(pi.doctor_name) as doc_norm,
      p.cost_center_code,
      p.id as pid,
      date_trunc('month', p.competence_month::date)::date as m
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    where p.competence_month is not null
      and p.competence_month::date >= v_start
      and p.competence_month::date <  v_end
      and p.hospital_id = current_active_hospital()
      and (
        p_payment_id is null
        or (v_cc is not null and p.cost_center_code = v_cc)
        or (v_cc is null and p.id = p_payment_id)
      )
  ),
  doc_names as (
    select distinct doc_norm from raw where doc_norm is not null
  ),
  doc_spec as (
    select dn.doc_norm,
      coalesce(
        (select (d.specialties)[1] from public.doctors d
          where public.normalize_alias(d.full_name) = dn.doc_norm
            and d.specialties is not null and array_length(d.specialties,1) >= 1
          limit 1),
        (select (d2.specialties)[1] from public.doctor_aliases da
          join public.doctors d2 on d2.id = da.doctor_id
          where da.alias_normalized = dn.doc_norm
            and d2.specialties is not null and array_length(d2.specialties,1) >= 1
          limit 1)
      ) as spec
    from doc_names dn
  ),
  base as (
    select
      (r.gross_amount * coalesce(
        case when coalesce(pcf.bruto,0) > 0 then pcf.liquido / pcf.bruto else null end,
        1
      ))::numeric as valor_liquido,
      r.doctor_name,
      r.company_name,
      r.cost_center_code,
      r.pid,
      r.payment_id,
      r.m,
      coalesce(r.item_specialty, ds.spec, '(sem especialidade)') as especialidade
    from raw r
    left join doc_spec ds on ds.doc_norm = r.doc_norm
    left join public.payment_company_financials pcf
      on pcf.payment_id = r.payment_id and pcf.company_id = r.company_id
  ),
  tagged as (
    select
      case p_grouping
        when 'especialidade' then especialidade
        when 'empresa'       then coalesce(company_name, '(sem empresa)')
        when 'medico'        then coalesce(doctor_name, '(sem médico)')
        when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
        else '(?)'
      end as g1,
      case p_secondary
        when 'especialidade' then especialidade
        when 'empresa'       then coalesce(company_name, '(sem empresa)')
        when 'medico'        then coalesce(doctor_name, '(sem médico)')
        when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
        else null
      end as g2,
      m,
      valor_liquido,
      pid
    from base
  )
  select t.g1::text, null::text, t.m, sum(t.valor_liquido)::numeric
  from tagged t
  group by t.g1, t.m
  union all
  select t.g2::text, t.g1::text, t.m, sum(t.valor_liquido)::numeric
  from tagged t
  where t.g2 is not null
  group by t.g1, t.g2, t.m;
end;
$function$

;

-- ============================================================
-- public.get_payment_pivot(date, integer, text, text, uuid, text)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_payment_pivot(p_current_month date, p_months_back integer, p_grouping text, p_secondary text DEFAULT NULL::text, p_payment_id uuid DEFAULT NULL::uuid, p_track text DEFAULT NULL::text)
 RETURNS TABLE(group_key text, parent_key text, month_bucket date, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start date;
  v_end   date;
  v_curr  date;
  v_cc    text;
  v_track public.payment_track;
begin
  SET LOCAL statement_timeout = '30s';

  v_curr  := date_trunc('month', p_current_month)::date;
  v_start := v_curr - ((greatest(p_months_back,1) - 1) || ' month')::interval;
  v_end   := v_curr + interval '1 month';

  if p_payment_id is not null then
    select cost_center_code, payment_track
      into v_cc, v_track
    from public.payments
    where id = p_payment_id;
  end if;

  if p_track is not null and p_track <> 'todos' then
    v_track := p_track::public.payment_track;
  elsif p_track = 'todos' then
    v_track := NULL;
  end if;

  return query
  with raw as (
    select
      pi.id as item_id,
      pi.doctor_name,
      pi.company_name,
      pi.company_id,
      pi.payment_id,
      pi.gross_amount,
      nullif(btrim(pi.specialty), '') as item_specialty,
      public.normalize_alias(pi.doctor_name) as doc_norm,
      p.cost_center_code,
      p.id as pid,
      date_trunc('month', p.competence_month::date)::date as m
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    where p.competence_month is not null
      and p.competence_month::date >= v_start
      and p.competence_month::date <  v_end
      and p.hospital_id = current_active_hospital()
      and (
        p_payment_id is null
        or (v_cc is not null and p.cost_center_code = v_cc)
        or (v_cc is null and p.id = p_payment_id)
      )
      and (
        v_track is null
        or p.payment_track = v_track
      )
  ),
  doc_names as (
    select distinct doc_norm from raw where doc_norm is not null
  ),
  doc_spec as (
    select dn.doc_norm,
      coalesce(
        (select (d.specialties)[1] from public.doctors d
          where public.normalize_alias(d.full_name) = dn.doc_norm
            and d.specialties is not null and array_length(d.specialties,1) >= 1
          limit 1),
        (select (d2.specialties)[1] from public.doctor_aliases da
          join public.doctors d2 on d2.id = da.doctor_id
          where da.alias_normalized = dn.doc_norm
            and d2.specialties is not null and array_length(d2.specialties,1) >= 1
          limit 1)
      ) as spec
    from doc_names dn
  ),
  base as (
    select
      (r.gross_amount * coalesce(
        case when coalesce(pcf.bruto,0) > 0 then pcf.liquido / pcf.bruto else null end,
        1
      ))::numeric as valor_liquido,
      r.doctor_name,
      r.company_name,
      r.cost_center_code,
      r.pid,
      r.payment_id,
      r.m,
      coalesce(r.item_specialty, ds.spec, '(sem especialidade)') as especialidade
    from raw r
    left join doc_spec ds on ds.doc_norm = r.doc_norm
    left join public.payment_company_financials pcf
      on pcf.payment_id = r.payment_id and pcf.company_id = r.company_id
  ),
  tagged as (
    select
      case p_grouping
        when 'especialidade' then especialidade
        when 'empresa'       then coalesce(company_name, '(sem empresa)')
        when 'medico'        then coalesce(doctor_name, '(sem médico)')
        when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
        else '(?)'
      end as g1,
      case p_secondary
        when 'especialidade' then especialidade
        when 'empresa'       then coalesce(company_name, '(sem empresa)')
        when 'medico'        then coalesce(doctor_name, '(sem médico)')
        when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
        else null
      end as g2,
      m,
      valor_liquido,
      pid
    from base
  )
  select t.g1::text, null::text, t.m, sum(t.valor_liquido)::numeric
  from tagged t
  group by t.g1, t.m
  union all
  select t.g2::text, t.g1::text, t.m, sum(t.valor_liquido)::numeric
  from tagged t
  where t.g2 is not null
  group by t.g1, t.g2, t.m;
end;
$function$

;

-- ============================================================
-- public.get_cancelled_payments_summary(timestamptz, timestamptz, uuid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cancelled_payments_summary(p_start timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end timestamp with time zone DEFAULT now(), p_hospital_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('analista'::app_role,'validador'::app_role,'diretor'::app_role,'admin'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH groups_c AS (
    SELECT g.id AS group_id, g.payment_id, g.company_id, g.company_name,
           g.total_amount AS valor, g.cancelled_at, g.cancelled_by,
           g.cancellation_reason, g.cancellation_note,
           g.cancellation_reactivated_at,
           p.hospital_id
    FROM public.payment_company_groups g
    JOIN public.payments p ON p.id = g.payment_id
    WHERE g.cancelled_at IS NOT NULL
      AND g.cancelled_at BETWEEN p_start AND p_end
      AND p.hospital_id = current_active_hospital()
  ),
  items_c AS (
    SELECT pi.id AS item_id, pi.payment_id, pi.company_id, pi.company_name,
           pi.doctor_name, pi.procedure_code, pi.procedure_name,
           COALESCE(pi.gross_amount, pi.procedure_amount, 0) AS valor,
           pi.cancelled_at, pi.cancelled_by, pi.cancellation_reason, pi.cancellation_note,
           pi.cancellation_reactivated_at,
           p.hospital_id
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = pi.payment_id AND g.company_id = pi.company_id
    WHERE pi.is_cancelled = true
      AND pi.cancelled_at BETWEEN p_start AND p_end
      AND (g.cancelled_at IS NULL)
      AND p.hospital_id = current_active_hospital()
  ),
  by_reason AS (
    SELECT COALESCE(cancellation_reason::text,'outro') AS reason,
           COALESCE(SUM(valor),0)::numeric AS valor,
           COUNT(*)::int AS qtd
    FROM (
      SELECT cancellation_reason, valor FROM groups_c
      UNION ALL
      SELECT cancellation_reason, valor FROM items_c
    ) u
    GROUP BY 1 ORDER BY valor DESC
  ),
  summary AS (
    SELECT
      COALESCE((SELECT SUM(valor) FROM groups_c),0)
      + COALESCE((SELECT SUM(valor) FROM items_c),0) AS valor_total,
      (SELECT COUNT(*) FROM groups_c) AS qtd_grupos,
      (SELECT COUNT(*) FROM items_c)  AS qtd_itens
  ),
  list AS (
    SELECT 'grupo' AS nivel, gc.group_id AS id, gc.payment_id,
           gc.company_name, NULL::text AS doctor_name,
           NULL::text AS procedure_code, NULL::text AS procedure_name,
           gc.valor, gc.cancelled_at, gc.cancelled_by,
           gc.cancellation_reason::text AS reason, gc.cancellation_note AS note,
           (gc.cancellation_reactivated_at IS NOT NULL) AS reactivated,
           COALESCE(pr.full_name, pr.email, gc.cancelled_by::text) AS autor
    FROM groups_c gc LEFT JOIN public.profiles pr ON pr.id = gc.cancelled_by
    UNION ALL
    SELECT 'item', ic.item_id, ic.payment_id,
           ic.company_name, ic.doctor_name,
           ic.procedure_code, ic.procedure_name,
           ic.valor, ic.cancelled_at, ic.cancelled_by,
           ic.cancellation_reason::text, ic.cancellation_note,
           (ic.cancellation_reactivated_at IS NOT NULL),
           COALESCE(pr.full_name, pr.email, ic.cancelled_by::text)
    FROM items_c ic LEFT JOIN public.profiles pr ON pr.id = ic.cancelled_by
    ORDER BY cancelled_at DESC LIMIT 5000
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_reason', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_reason br),'[]'::jsonb),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM list l),'[]'::jsonb),
    'window', jsonb_build_object('start',p_start,'end',p_end,'hospital_id',current_active_hospital())
  ) INTO v_result;
  RETURN v_result;
END; $function$

;

-- ============================================================
-- public.get_cancellation_report_detailed(timestamptz, timestamptz, uuid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cancellation_report_detailed(p_start timestamp with time zone DEFAULT (now() - '90 days'::interval), p_end timestamp with time zone DEFAULT now(), p_hospital_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('analista'::app_role,'validador'::app_role,'diretor'::app_role,'admin'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH g AS (
    SELECT
      pg.id              AS group_id,
      pg.payment_id,
      pg.company_id,
      pg.company_name,
      pg.bruto_total,
      pg.liquido_total,
      pg.total_amount,
      pg.cancellation_reason,
      pg.cancellation_note,
      pg.cancelled_at,
      pg.cancelled_by,
      pg.cancellation_reactivated_at,
      p.hospital_id,
      p.competencia,
      p.reference_month,
      p.created_at       AS payment_created_at,
      au.email           AS autor_email,
      pr.full_name       AS autor_nome,
      (SELECT count(*) FROM public.payment_items pi
        WHERE pi.payment_id = pg.payment_id
          AND pi.company_id = pg.company_id
          AND pi.is_cancelled = true) AS items_cancelados
    FROM public.payment_company_groups pg
    JOIN public.payments p ON p.id = pg.payment_id
    LEFT JOIN auth.users au ON au.id = pg.cancelled_by
    LEFT JOIN public.profiles pr ON pr.user_id = pg.cancelled_by
    WHERE pg.cancelled_at IS NOT NULL
      AND pg.cancelled_at BETWEEN p_start AND p_end
      AND p.hospital_id = current_active_hospital()
  ),
  by_company AS (
    SELECT
      company_id,
      max(company_name) AS company_name,
      count(*)                                                    AS qtd_grupos,
      count(*) FILTER (WHERE cancellation_reactivated_at IS NULL) AS qtd_ativos,
      count(*) FILTER (WHERE cancellation_reactivated_at IS NOT NULL) AS qtd_reativados,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount,
      sum(items_cancelados)          AS itens_cancelados,
      jsonb_agg(DISTINCT cancellation_reason::text)
        FILTER (WHERE cancellation_reason IS NOT NULL) AS motivos
    FROM g
    GROUP BY company_id
  ),
  by_payment AS (
    SELECT
      payment_id,
      max(competencia)::text     AS competencia,
      max(reference_month)       AS reference_month,
      count(*)                   AS grupos_afetados,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount,
      sum(items_cancelados)          AS itens_cancelados,
      jsonb_agg(DISTINCT cancellation_reason::text)
        FILTER (WHERE cancellation_reason IS NOT NULL) AS motivos,
      jsonb_agg(jsonb_build_object(
        'group_id', group_id,
        'company_id', company_id,
        'company_name', company_name,
        'bruto_total', bruto_total,
        'liquido_total', liquido_total,
        'total_amount', total_amount,
        'reason', cancellation_reason,
        'note', cancellation_note,
        'cancelled_at', cancelled_at,
        'reactivated', cancellation_reactivated_at IS NOT NULL,
        'autor', coalesce(autor_nome, autor_email),
        'items_cancelados', items_cancelados
      ) ORDER BY company_name) AS grupos
    FROM g
    GROUP BY payment_id
  ),
  by_reason AS (
    SELECT
      cancellation_reason::text AS reason,
      count(*)                       AS qtd,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount
    FROM g
    GROUP BY cancellation_reason
  ),
  totals AS (
    SELECT
      count(*)                                                    AS qtd_grupos,
      count(DISTINCT payment_id)                                  AS qtd_pagamentos,
      count(DISTINCT company_id)                                  AS qtd_empresas,
      coalesce(sum(bruto_total),0)   AS bruto_total,
      coalesce(sum(liquido_total),0) AS liquido_total,
      coalesce(sum(total_amount),0)  AS total_amount,
      sum(items_cancelados)          AS itens_cancelados,
      count(*) FILTER (WHERE cancellation_reactivated_at IS NOT NULL) AS qtd_reativados
    FROM g
  )
  SELECT jsonb_build_object(
    'window', jsonb_build_object('start', p_start, 'end', p_end, 'hospital_id', current_active_hospital()),
    'totals', (SELECT to_jsonb(t.*) FROM totals t),
    'by_reason', coalesce((SELECT jsonb_agg(to_jsonb(r.*) ORDER BY r.bruto_total DESC) FROM by_reason r), '[]'::jsonb),
    'by_company', coalesce((SELECT jsonb_agg(to_jsonb(c.*) ORDER BY c.bruto_total DESC) FROM by_company c), '[]'::jsonb),
    'by_payment', coalesce((SELECT jsonb_agg(to_jsonb(p.*) ORDER BY p.bruto_total DESC) FROM by_payment p), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$

;

-- ============================================================
-- public.get_intervention_savings(timestamptz, timestamptz, uuid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_intervention_savings(p_start timestamp with time zone DEFAULT (now() - '30 days'::interval), p_end timestamp with time zone DEFAULT now(), p_hospital_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_uid
      AND ur.role IN ('diretor'::app_role,'admin'::app_role,'validador'::app_role,'analista'::app_role)
  ) INTO v_allowed;
  IF NOT v_allowed THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH intervenors AS (
    SELECT ur.user_id, ur.role::text AS role FROM public.user_roles ur
    WHERE ur.role IN ('diretor'::app_role,'validador'::app_role)
  ),
  obs AS (
    SELECT o.id, o.payment_id, o.item_id, o.author_id, o.created_at, i.role
    FROM public.payment_observations o
    JOIN intervenors i ON i.user_id = o.author_id
    WHERE o.created_at BETWEEN p_start AND p_end
      AND (o.status_to = 'devolvido_analista'
        OR (o.item_id IS NOT NULL AND o.observation_type = 'impacta_aprovacao'::observation_type))
  ),
  candidate_items AS (
    SELECT pi.id AS item_id, pi.payment_id, pi.company_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings, pi.is_cancelled,
           o.id AS obs_id, o.author_id, o.role, o.created_at AS obs_at
    FROM obs o JOIN public.payment_items pi ON pi.id = o.item_id
    WHERE o.item_id IS NOT NULL
    UNION ALL
    SELECT pi.id, pi.payment_id, pi.company_id, pi.expected_amount, pi.gross_amount,
           pi.acatado_at, pi.validation_findings, pi.is_cancelled,
           o.id, o.author_id, o.role, o.created_at
    FROM obs o JOIN public.payment_items pi ON pi.payment_id = o.payment_id
    WHERE o.item_id IS NULL
      AND pi.validation_findings IS NOT NULL
      AND jsonb_typeof(pi.validation_findings) = 'array'
      AND jsonb_array_length(pi.validation_findings) > 0
  ),
  eligible AS (
    SELECT ci.*
    FROM candidate_items ci
    JOIN public.payments p ON p.id = ci.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = ci.payment_id
     AND (g.company_id = ci.company_id OR g.company_name = (SELECT company_name FROM public.payment_items x WHERE x.id = ci.item_id))
    WHERE ci.acatado_at IS NOT NULL
      AND ci.acatado_at > ci.obs_at
      AND ci.expected_amount IS NOT NULL AND ci.expected_amount > 0
      AND ci.gross_amount    IS NOT NULL AND ci.gross_amount    > 0
      AND ci.is_cancelled = false
      AND (g.status IS NULL OR g.status <> 'cancelado'::payment_status)
      AND p.status IN ('pago','arquivado','aprovado','aprovado_em_revisao')
      AND p.hospital_id = current_active_hospital()
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY item_id ORDER BY obs_at DESC) AS rn FROM eligible
  ),
  final_intervention AS (
    SELECT item_id, payment_id, company_id, obs_id::text AS obs_id, author_id, role, obs_at, acatado_at,
           expected_amount AS valor_regra,
           gross_amount    AS valor_pago_final,
           (expected_amount - gross_amount) AS delta
    FROM ranked WHERE rn = 1
  ),
  analyst_edits_raw AS (
    SELECT o.id AS obs_id, o.payment_id, o.item_id, o.author_id, o.created_at AS obs_at,
           NULLIF((regexp_match(o.message, 'valor:\s*([0-9]+(?:[\.,][0-9]+)?)\s*[→>]\s*([0-9]+(?:[\.,][0-9]+)?)'))[1], '') AS old_s,
           NULLIF((regexp_match(o.message, 'valor:\s*([0-9]+(?:[\.,][0-9]+)?)\s*[→>]\s*([0-9]+(?:[\.,][0-9]+)?)'))[2], '') AS new_s
    FROM public.payment_observations o
    WHERE o.created_at BETWEEN p_start AND p_end
      AND o.author_type = 'analista'::observation_author
      AND o.item_id IS NOT NULL
      AND o.message ILIKE 'Item editado pelo analista%'
  ),
  analyst_edits AS (
    SELECT ae.obs_id, ae.payment_id, ae.item_id, ae.author_id, ae.obs_at,
           replace(ae.old_s, ',', '.')::numeric AS old_val,
           replace(ae.new_s, ',', '.')::numeric AS new_val
    FROM analyst_edits_raw ae
    WHERE ae.old_s IS NOT NULL AND ae.new_s IS NOT NULL
  ),
  analyst_final AS (
    SELECT ae.item_id, ae.payment_id, pi.company_id, ae.obs_id::text AS obs_id, ae.author_id,
           'analista'::text AS role, ae.obs_at, ae.obs_at AS acatado_at,
           ae.old_val AS valor_regra, ae.new_val AS valor_pago_final,
           (ae.old_val - ae.new_val) AS delta
    FROM analyst_edits ae
    JOIN public.payment_items pi ON pi.id = ae.item_id
    JOIN public.payments p ON p.id = ae.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = ae.payment_id
     AND (g.company_id = pi.company_id OR g.company_name = pi.company_name)
    WHERE ae.old_val IS NOT NULL AND ae.new_val IS NOT NULL
      AND ae.old_val <> ae.new_val
      AND pi.is_cancelled = false
      AND (g.status IS NULL OR g.status <> 'cancelado'::payment_status)
      AND p.status <> 'cancelado'::payment_status
      AND p.hospital_id = current_active_hospital()
  ),
  group_cancels AS (
    SELECT pi.id AS item_id, g.payment_id, pi.company_id, g.id::text AS obs_id,
           g.cancelled_by AS author_id,
           CASE WHEN g.cancellation_source = 'reconciliacao'
                THEN 'cancelamento_conciliacao'::text
                ELSE 'cancelamento_empresa'::text END AS role,
           g.cancelled_at AS obs_at, g.cancelled_at AS acatado_at,
           COALESCE(pi.gross_amount, 0) AS valor_regra,
           0::numeric AS valor_pago_final,
           COALESCE(pi.gross_amount, 0) AS delta
    FROM public.payment_company_groups g
    JOIN public.payments p ON p.id = g.payment_id
    JOIN public.payment_items pi
      ON pi.payment_id = g.payment_id
     AND (pi.company_id = g.company_id OR pi.company_name = g.company_name)
    WHERE g.cancelled_at IS NOT NULL
      AND g.cancelled_at BETWEEN p_start AND p_end
      AND g.cancellation_reactivated_at IS NULL
      AND COALESCE(pi.gross_amount, 0) > 0
      AND p.hospital_id = current_active_hospital()
  ),
  item_cancels AS (
    SELECT pi.id AS item_id, pi.payment_id, pi.company_id, pi.id::text AS obs_id,
           pi.cancelled_by AS author_id,
           CASE WHEN pi.cancellation_source = 'reconciliacao'
                THEN 'cancelamento_conciliacao'::text
                ELSE 'cancelamento_item'::text END AS role,
           pi.cancelled_at AS obs_at, pi.cancelled_at AS acatado_at,
           COALESCE(pi.gross_amount, 0) AS valor_regra,
           0::numeric AS valor_pago_final,
           COALESCE(pi.gross_amount, 0) AS delta
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    LEFT JOIN public.payment_company_groups g
      ON g.payment_id = pi.payment_id
     AND (g.company_id = pi.company_id OR g.company_name = pi.company_name)
    WHERE pi.is_cancelled = true
      AND pi.cancelled_at IS NOT NULL
      AND pi.cancelled_at BETWEEN p_start AND p_end
      AND pi.cancellation_reactivated_at IS NULL
      AND COALESCE(pi.gross_amount, 0) > 0
      AND (g.cancelled_at IS NULL
           OR g.cancelled_at NOT BETWEEN p_start AND p_end
           OR g.cancellation_reactivated_at IS NOT NULL)
      AND p.hospital_id = current_active_hospital()
  ),
  final_items AS (
    SELECT * FROM final_intervention
    UNION ALL SELECT * FROM analyst_final
    UNION ALL SELECT * FROM group_cancels
    UNION ALL SELECT * FROM item_cancels
  ),
  summary AS (
    SELECT COALESCE(SUM(CASE WHEN delta>0 THEN delta ELSE 0 END),0)::numeric AS economia,
           COALESCE(SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END),0)::numeric AS perda,
           COALESCE(SUM(delta),0)::numeric AS saldo,
           COUNT(*)::int AS qtd_itens FROM final_items
  ),
  by_role AS (
    SELECT role, COALESCE(SUM(delta),0)::numeric AS saldo, COUNT(*)::int AS qtd
    FROM final_items GROUP BY role
  ),
  by_user AS (
    SELECT fi.author_id AS user_id,
           COALESCE(pr.full_name, pr.email, fi.author_id::text, 'Sistema') AS nome,
           fi.role, COUNT(*)::int AS qtd_itens,
           COALESCE(SUM(CASE WHEN delta>0 THEN delta ELSE 0 END),0)::numeric AS economia,
           COALESCE(SUM(CASE WHEN delta<0 THEN -delta ELSE 0 END),0)::numeric AS perda,
           COALESCE(SUM(delta),0)::numeric AS saldo
    FROM final_items fi LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    WHERE fi.author_id IS NOT NULL
    GROUP BY fi.author_id, pr.full_name, pr.email, fi.role
    ORDER BY saldo DESC
  ),
  items_list AS (
    SELECT fi.item_id, fi.payment_id, fi.obs_id, fi.valor_regra, fi.valor_pago_final, fi.delta,
           fi.author_id, COALESCE(pr.full_name, pr.email, fi.author_id::text, 'Sistema') AS autor, fi.role,
           fi.obs_at, fi.acatado_at,
           pi.doctor_name, pi.procedure_code, pi.procedure_name, pi.company_name,
           pcg.id AS company_group_id
    FROM final_items fi
    LEFT JOIN public.profiles pr ON pr.id = fi.author_id
    LEFT JOIN public.payment_items pi ON pi.id = fi.item_id
    LEFT JOIN public.payment_company_groups pcg
      ON pcg.payment_id = fi.payment_id
     AND (pcg.company_id = fi.company_id OR pcg.company_name = pi.company_name)
    ORDER BY fi.acatado_at DESC LIMIT 5000
  )
  SELECT jsonb_build_object(
    'summary', (SELECT to_jsonb(s) FROM summary s),
    'by_role', COALESCE((SELECT jsonb_agg(to_jsonb(br)) FROM by_role br), '[]'::jsonb),
    'by_user', COALESCE((SELECT jsonb_agg(to_jsonb(bu)) FROM by_user bu), '[]'::jsonb),
    'items',   COALESCE((SELECT jsonb_agg(to_jsonb(il)) FROM items_list il), '[]'::jsonb),
    'window',  jsonb_build_object('start',p_start,'end',p_end,'hospital_id',current_active_hospital())
  ) INTO v_result;
  RETURN v_result;
END;
$function$

;


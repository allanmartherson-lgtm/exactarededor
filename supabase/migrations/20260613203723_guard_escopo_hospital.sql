CREATE OR REPLACE FUNCTION public.get_spend_trend(p_current_month date, p_months_back integer, p_grouping text)
 RETURNS TABLE(group_key text, month_bucket date, total numeric)
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
        (select (specialties)[1] from public.doctors d
           where lower(btrim(d.full_name)) = lower(btrim(pi.doctor_name)) limit 1),
        '(sem especialidade)'
      ) as especialidade
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    where p.competence_month is not null
      and p.competence_month::date >= v_start
      and p.competence_month::date <  v_end
      and p.hospital_id = current_active_hospital()
  )
  select
    case p_grouping
      when 'especialidade' then especialidade
      when 'empresa'       then coalesce(company_name, '(sem empresa)')
      when 'medico'        then coalesce(doctor_name, '(sem médico)')
      when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
      else '(?)'
    end as group_key,
    m as month_bucket,
    sum(gross_amount)::numeric as total
  from base
  group by 1, 2;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_spend_trend(p_current_month date, p_months_back integer, p_grouping text, p_track text DEFAULT NULL::text)
 RETURNS TABLE(group_key text, month_bucket date, total numeric)
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
        (select (specialties)[1] from public.doctors d
           where lower(btrim(d.full_name)) = lower(btrim(pi.doctor_name)) limit 1),
        '(sem especialidade)'
      ) as especialidade
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    where p.competence_month is not null
      and p.competence_month::date >= v_start
      and p.competence_month::date <  v_end
      and p.hospital_id = current_active_hospital()
      and (
        p_track is null
        or (p_track = 'nao_classificado' and p.payment_track is null)
        or (p_track in ('prioritario','habitual') and p.payment_track::text = p_track)
      )
  )
  select
    case p_grouping
      when 'especialidade' then especialidade
      when 'empresa'       then coalesce(company_name, '(sem empresa)')
      when 'medico'        then coalesce(doctor_name, '(sem médico)')
      when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
      else '(?)'
    end as group_key,
    m as month_bucket,
    sum(gross_amount)::numeric as total
  from base
  group by 1, 2;
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_dre_consolidated(p_competencia_from date DEFAULT NULL::date, p_competencia_to date DEFAULT NULL::date, p_company_id uuid DEFAULT NULL::uuid, p_doctor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(competencia date, company_id uuid, company_name text, doctor_id uuid, doctor_name text, bruto numeric, debitos numeric, creditos numeric, glosas numeric, pool numeric, liquido numeric, payments_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fin AS (
    SELECT
      date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date AS competencia,
      pcf.company_id,
      COALESCE(SUM(pcf.bruto),0)    AS bruto,
      COALESCE(SUM(pcf.debitos),0)  AS debitos,
      COALESCE(SUM(pcf.creditos),0) AS creditos,
      COALESCE(SUM(pcf.glosas),0)   AS glosas,
      COALESCE(SUM(pcf.pool),0)     AS pool,
      COUNT(DISTINCT pcf.payment_id) AS payments_count
    FROM public.payment_company_financials pcf
    JOIN public.payments p ON p.id = pcf.payment_id
    WHERE (p_competencia_from IS NULL OR date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date >= p_competencia_from)
      AND (p_competencia_to   IS NULL OR date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date <= p_competencia_to)
      AND (p_company_id IS NULL OR pcf.company_id = p_company_id)
      AND p.hospital_id = current_active_hospital()
    GROUP BY 1, 2
  ),
  docs AS (
    SELECT
      date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date AS competencia,
      pi.company_id,
      COUNT(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL) AS n_docs,
      (array_agg(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL))[1] AS rep_doctor_id
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.company_id IS NOT NULL
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
            AND date_trunc('month', COALESCE(p2.competence_month, p2.created_at::date))::date = f.competencia
            AND p2.hospital_id = current_active_hospital()
        ))
  ORDER BY f.competencia DESC, c.name;
$function$

;

CREATE OR REPLACE FUNCTION public.get_dre_consolidated(p_competencia_from date DEFAULT NULL::date, p_competencia_to date DEFAULT NULL::date, p_company_id uuid DEFAULT NULL::uuid, p_doctor_id uuid DEFAULT NULL::uuid, p_track text DEFAULT NULL::text)
 RETURNS TABLE(competencia date, company_id uuid, company_name text, doctor_id uuid, doctor_name text, bruto numeric, debitos numeric, creditos numeric, glosas numeric, pool numeric, liquido numeric, payments_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH fin AS (
    SELECT
      date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date AS competencia,
      pcf.company_id,
      COALESCE(SUM(pcf.bruto),0)    AS bruto,
      COALESCE(SUM(pcf.debitos),0)  AS debitos,
      COALESCE(SUM(pcf.creditos),0) AS creditos,
      COALESCE(SUM(pcf.glosas),0)   AS glosas,
      COALESCE(SUM(pcf.pool),0)     AS pool,
      COUNT(DISTINCT pcf.payment_id) AS payments_count
    FROM public.payment_company_financials pcf
    JOIN public.payments p ON p.id = pcf.payment_id
    WHERE (p_competencia_from IS NULL OR date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date >= p_competencia_from)
      AND (p_competencia_to   IS NULL OR date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date <= p_competencia_to)
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
      date_trunc('month', COALESCE(p.competence_month, p.created_at::date))::date AS competencia,
      pi.company_id,
      COUNT(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL) AS n_docs,
      (array_agg(DISTINCT pi.doctor_id) FILTER (WHERE pi.doctor_id IS NOT NULL))[1] AS rep_doctor_id
    FROM public.payment_items pi
    JOIN public.payments p ON p.id = pi.payment_id
    WHERE pi.company_id IS NOT NULL
      AND p.hospital_id = current_active_hospital()
      AND (
        p_track IS NULL
        OR (p_track = 'nao_classificado' AND p.payment_track IS NULL)
        OR (p_track IN ('prioritario','habitual') AND p.payment_track::text = p_track)
      )
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
            AND date_trunc('month', COALESCE(p2.competence_month, p2.created_at::date))::date = f.competencia
            AND p2.hospital_id = current_active_hospital()
        ))
  ORDER BY f.competencia DESC, c.name;
$function$

;

CREATE OR REPLACE FUNCTION public.audit_hospital_scope()
 RETURNS TABLE(proname text, args text, motivo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Guard multi-tenant: aponta RPCs de LEITURA que rodam como SECURITY DEFINER
  -- (donas por role com BYPASSRLS, portanto ignoram RLS), leem a tabela payments,
  -- e NÃO aplicam o filtro de hospital ativo (current_active_hospital()).
  -- Funções escopadas por médico (portal) são isentas automaticamente por
  -- referenciarem portal_can_access_doctor ou doctor_portal_users.
  WITH cand AS (
    SELECT p.proname::text AS proname,
           pg_get_function_identity_arguments(p.oid) AS args,
           pg_get_functiondef(p.oid) AS def,
           pg_get_userbyid(p.proowner) AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef = true
  )
  SELECT proname, args,
         'SECURITY DEFINER lê payments sem current_active_hospital()' AS motivo
  FROM cand
  WHERE owner IN (SELECT rolname FROM pg_roles WHERE rolbypassrls)
    AND (def ILIKE '%from public.payments%' OR def ILIKE '%join public.payments%')
    AND def NOT ILIKE '%current_active_hospital%'
    AND (proname ~* '^(get_|list_|fetch_)'
         OR proname ~* '(_kpis|_stats|_pivot|_report|_detail|_position|_summary|_overview|_dashboard|_trend|_breakdown)$')
    AND def NOT ILIKE '%portal_can_access_doctor%'
    AND def NOT ILIKE '%doctor_portal_users%'
  ORDER BY proname;
$function$

;

REVOKE EXECUTE ON FUNCTION public.audit_hospital_scope() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_hospital_scope() FROM anon;
REVOKE EXECUTE ON FUNCTION public.audit_hospital_scope() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.audit_hospital_scope() TO service_role;

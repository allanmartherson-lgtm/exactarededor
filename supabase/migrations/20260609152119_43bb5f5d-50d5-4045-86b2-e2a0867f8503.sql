
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
  v_keys  text[];
begin
  SET LOCAL statement_timeout = '30s';

  v_curr  := date_trunc('month', p_current_month)::date;
  v_start := v_curr - ((greatest(p_months_back,1) - 1) || ' month')::interval;
  v_end   := v_curr + interval '1 month';

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
      and (
        p_payment_id is null
        or date_trunc('month', p.competence_month::date)::date < v_curr
        or p.id = p_payment_id
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
  ),
  keys_curr as (
    select distinct g1 from tagged where p_payment_id is not null and pid = p_payment_id
  ),
  filtered as (
    select t.* from tagged t
    where p_payment_id is null
       or t.g1 in (select g1 from keys_curr)
  )
  select f.g1::text, null::text, f.m, sum(f.valor_liquido)::numeric
  from filtered f
  group by f.g1, f.m
  union all
  select f.g2::text, f.g1::text, f.m, sum(f.valor_liquido)::numeric
  from filtered f
  where f.g2 is not null
  group by f.g1, f.g2, f.m;
end;
$function$;

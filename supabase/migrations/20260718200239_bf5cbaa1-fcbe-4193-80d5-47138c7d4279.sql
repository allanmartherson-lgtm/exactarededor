
CREATE OR REPLACE FUNCTION public.get_spend_trend(p_current_month date, p_months_back integer, p_grouping text)
 RETURNS TABLE(group_key text, month_bucket date, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
        (d.specialties)[1],
        '(sem especialidade)'
      ) as especialidade
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    left join public.doctors d on lower(btrim(d.full_name)) = lower(btrim(pi.doctor_name))
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
$function$;

CREATE OR REPLACE FUNCTION public.get_spend_trend(p_current_month date, p_months_back integer, p_grouping text, p_track text DEFAULT NULL::text)
 RETURNS TABLE(group_key text, month_bucket date, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
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
        (d.specialties)[1],
        '(sem especialidade)'
      ) as especialidade
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    left join public.doctors d on lower(btrim(d.full_name)) = lower(btrim(pi.doctor_name))
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
$function$;

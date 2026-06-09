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
        -- 1) especialidade já preenchida no item (planilha/motor)
        nullif(btrim(pi.specialty), ''),
        -- 2) especialidade do médico cadastrado, com match por nome normalizado (unaccent+lower+espaços)
        (
          select (d.specialties)[1]
          from public.doctors d
          where public.normalize_alias(d.full_name) = public.normalize_alias(pi.doctor_name)
            and d.specialties is not null
            and array_length(d.specialties, 1) >= 1
          limit 1
        ),
        -- 3) especialidade do médico via doctor_aliases (alias_normalized usa mesma normalize_alias)
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
$function$;

create or replace function public.get_payment_pivot(
  p_current_month date,
  p_months_back int,
  p_grouping text,
  p_secondary text default null
)
returns table(
  group_key text,
  parent_key text,
  month_bucket date,
  total numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
begin
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
        (select d.specialties[1] from public.doctors d
          where lower(btrim(d.full_name)) = lower(btrim(pi.doctor_name)) limit 1),
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
  -- Primary level rows
  select g1 as group_key, null::text as parent_key, m as month_bucket, sum(gross_amount)::numeric as total
  from tagged
  group by g1, m
  union all
  -- Secondary level rows (only when p_secondary is provided)
  select g2 as group_key, g1 as parent_key, m as month_bucket, sum(gross_amount)::numeric as total
  from tagged
  where p_secondary is not null and g2 is not null
  group by g2, g1, m;
end;
$$;

grant execute on function public.get_payment_pivot(date, int, text, text) to authenticated;

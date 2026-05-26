
CREATE OR REPLACE FUNCTION public.get_payment_pivot(
  p_current_month date,
  p_months_back integer,
  p_grouping text,
  p_secondary text DEFAULT NULL::text,
  p_payment_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(group_key text, parent_key text, month_bucket date, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_start date;
  v_end   date;
  v_keys  text[];
begin
  SET LOCAL statement_timeout = '30s';

  v_start := (date_trunc('month', p_current_month)::date) - ((greatest(p_months_back,1) - 1) || ' month')::interval;
  v_end   := (date_trunc('month', p_current_month)::date) + interval '1 month';

  -- Quando o lote é informado, restringimos o universo aos grupos
  -- (empresa/especialidade/médico/CC) presentes nesse lote — assim a
  -- comparação histórica fica "do mesmo recorte", e não da base inteira.
  if p_payment_id is not null then
    select array_agg(distinct k) into v_keys from (
      select
        case p_grouping
          when 'especialidade' then coalesce(d.spec, '(sem especialidade)')
          when 'empresa'       then coalesce(pi.company_name, '(sem empresa)')
          when 'medico'        then coalesce(pi.doctor_name, '(sem médico)')
          when 'centro_custo'  then coalesce(p.cost_center_code, '(sem CC)')
          else '(?)'
        end as k
      from public.payment_items pi
      join public.payments p on p.id = pi.payment_id
      left join lateral (
        select (specialties)[1] as spec
        from public.doctors
        where lower(btrim(full_name)) = lower(btrim(pi.doctor_name))
        limit 1
      ) d on true
      where pi.payment_id = p_payment_id
    ) s;
  end if;

  return query
  with base as (
    select
      (pi.gross_amount * coalesce(
        case when coalesce(pcf.bruto, 0) > 0 then pcf.liquido / pcf.bruto else null end,
        1
      ))::numeric as valor_liquido,
      pi.doctor_name,
      pi.company_name,
      p.cost_center_code,
      date_trunc('month', p.competence_month::date)::date as m,
      coalesce(d.spec, '(sem especialidade)') as especialidade
    from public.payment_items pi
    join public.payments p on p.id = pi.payment_id
    left join public.payment_company_financials pcf
      on pcf.payment_id = pi.payment_id and pcf.company_id = pi.company_id
    left join lateral (
      select (specialties)[1] as spec
      from public.doctors
      where lower(btrim(full_name)) = lower(btrim(pi.doctor_name))
      limit 1
    ) d on true
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
      valor_liquido
    from base
  ),
  filtered as (
    select * from tagged t
    where v_keys is null or t.g1 = any(v_keys)
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

GRANT EXECUTE ON FUNCTION public.get_payment_pivot(date, int, text, text, uuid) TO authenticated;

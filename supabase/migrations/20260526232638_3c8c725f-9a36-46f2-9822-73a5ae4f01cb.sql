
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
begin
  SET LOCAL statement_timeout = '30s';

  v_start := (date_trunc('month', p_current_month)::date) - ((greatest(p_months_back,1) - 1) || ' month')::interval;
  v_end   := (date_trunc('month', p_current_month)::date) + interval '1 month';

  return query
  with base as (
    select
      -- Líquido escalonado: gross * (liquido_empresa / bruto_empresa).
      -- Sem snapshot ou bruto zero → mantém o gross (não introduz distorção).
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
$function$;

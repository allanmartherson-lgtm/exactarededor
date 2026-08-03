CREATE OR REPLACE FUNCTION public.get_payment_pivot(p_current_month date, p_months_back integer, p_grouping text, p_secondary text DEFAULT NULL::text, p_payment_id uuid DEFAULT NULL::uuid, p_track text DEFAULT NULL::text, p_tertiary text DEFAULT NULL::text)
 RETURNS TABLE(group_key text, parent_key text, month_bucket date, total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_start date;
  v_end   date;
  v_curr  date;
  v_cc    text;
  v_track public.payment_track;
  v_sep   text := chr(31);
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
  with payments_scope as (
    select p.id, p.cost_center_code, p.pool_id,
           date_trunc('month', p.competence_month::date)::date as m
    from public.payments p
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
  raw_items as (
    select
      pi.doctor_name,
      pi.company_name,
      pi.company_id,
      pi.payment_id,
      pi.gross_amount,
      nullif(btrim(pi.specialty), '') as item_specialty,
      public.normalize_alias(pi.doctor_name) as doc_norm,
      ps.cost_center_code,
      ps.m
    from public.payment_items pi
    join payments_scope ps on ps.id = pi.payment_id
    where ps.pool_id is null
      and coalesce(pi.is_cancelled, false) = false
      and coalesce(pi.package_absorbed, false) = false
  ),
  doc_names as (
    select distinct doc_norm from raw_items where doc_norm is not null
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
  lote_factor as (
    select pcf.payment_id,
           case when sum(coalesce(pcf.bruto,0)) > 0
                then sum(coalesce(pcf.liquido,0)) / sum(coalesce(pcf.bruto,0))
                else null end as factor
    from public.payment_company_financials pcf
    where pcf.payment_id in (select id from payments_scope)
    group by pcf.payment_id
  ),
  base_nonpool as (
    select
      (r.gross_amount * coalesce(
        case when coalesce(pcf.bruto,0) > 0 then pcf.liquido / pcf.bruto else null end,
        lf.factor,
        1
      ))::numeric as valor_liquido,
      r.doctor_name,
      r.company_name,
      r.cost_center_code,
      r.m,
      coalesce(r.item_specialty, ds.spec, '(sem especialidade)') as especialidade
    from raw_items r
    left join doc_spec ds on ds.doc_norm = r.doc_norm
    left join public.payment_company_financials pcf
      on pcf.payment_id = r.payment_id and pcf.company_id = r.company_id
    left join lote_factor lf on lf.payment_id = r.payment_id
  ),
  base_pool as (
    select
      coalesce(pcg.liquido_total, pcg.total_amount, 0)::numeric as valor_liquido,
      null::text as doctor_name,
      pcg.company_name,
      ps.cost_center_code,
      ps.m,
      coalesce('(pool) ' || pl.nome, '(pool)') as especialidade
    from public.payment_company_groups pcg
    join payments_scope ps on ps.id = pcg.payment_id
    left join public.pools pl on pl.id = ps.pool_id
    where ps.pool_id is not null
      and coalesce(pcg.status::text, '') <> 'cancelado'
      and coalesce(pcg.liquido_total, pcg.total_amount, 0) > 0
  ),
  base as (
    select valor_liquido, doctor_name, company_name, cost_center_code, m, especialidade
    from base_nonpool
    union all
    select valor_liquido, doctor_name, company_name, cost_center_code, m, especialidade
    from base_pool
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
      case p_tertiary
        when 'especialidade' then especialidade
        when 'empresa'       then coalesce(company_name, '(sem empresa)')
        when 'medico'        then coalesce(doctor_name, '(sem médico)')
        when 'centro_custo'  then coalesce(cost_center_code, '(sem CC)')
        else null
      end as g3,
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
  group by t.g1, t.g2, t.m
  union all
  -- Nível 3: parent_key carrega "g1<sep>g2" para o cliente reconstruir a hierarquia.
  select t.g3::text, (t.g1 || v_sep || t.g2)::text, t.m, sum(t.valor_liquido)::numeric
  from tagged t
  where t.g2 is not null and t.g3 is not null
  group by t.g1, t.g2, t.g3, t.m;
end;
$function$;
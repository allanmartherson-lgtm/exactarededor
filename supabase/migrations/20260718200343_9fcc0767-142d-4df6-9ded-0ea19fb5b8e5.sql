
CREATE OR REPLACE FUNCTION public.get_doctor_concentration(
  p_months_back integer DEFAULT 6,
  p_track text DEFAULT NULL
)
RETURNS TABLE(
  payment_id uuid,
  reference text,
  doctor_name text,
  amount numeric,
  total_lote numeric,
  pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_cutoff date;
begin
  SET LOCAL statement_timeout = '15s';
  v_cutoff := (date_trunc('month', now())::date) - ((greatest(p_months_back,1) - 1) || ' month')::interval;

  return query
  with filtered_payments as (
    select p.id, coalesce(p.reference, p.title, 'Sem referência') as ref
    from public.payments p
    where p.hospital_id = current_active_hospital()
      and p.competence_month is not null
      and p.competence_month::date >= v_cutoff
      and p.status not in ('rascunho','cancelado','rejeitado')
      and (
        p_track is null
        or (p_track = 'nao_classificado' and p.payment_track is null)
        or (p_track in ('prioritario','habitual') and p.payment_track::text = p_track)
      )
  ),
  items as (
    select pi.payment_id, pi.doctor_name, pi.gross_amount
    from public.payment_items pi
    join filtered_payments fp on fp.id = pi.payment_id
    where pi.gross_amount > 0
      and pi.doctor_name is not null
      and btrim(pi.doctor_name) <> ''
  ),
  per_doctor as (
    select payment_id, doctor_name, sum(gross_amount)::numeric as amount
    from items
    group by payment_id, doctor_name
  ),
  totals as (
    select payment_id, sum(gross_amount)::numeric as total_lote
    from items
    group by payment_id
  )
  select
    pd.payment_id,
    fp.ref as reference,
    pd.doctor_name,
    pd.amount,
    t.total_lote,
    round((pd.amount / nullif(t.total_lote, 0)) * 100, 2) as pct
  from per_doctor pd
  join totals t on t.payment_id = pd.payment_id
  join filtered_payments fp on fp.id = pd.payment_id
  where t.total_lote > 0
  order by pct desc nulls last
  limit 50;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_doctor_concentration(integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_doctor_concentration(integer, text) TO authenticated, service_role;

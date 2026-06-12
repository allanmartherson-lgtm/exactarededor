
create or replace function public.reconcile_job_progress(_job_id uuid)
returns public.payment_processing_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.payment_processing_jobs;
  completed_groups int;
  failed_count int;
  new_processed int;
  new_status text;
begin
  select * into job from public.payment_processing_jobs where id = _job_id;
  if not found then
    return null;
  end if;

  select count(*) into completed_groups
  from public.payment_company_groups g
  where g.payment_id = job.payment_id
    and coalesce(g.status::text, '') <> 'em_analise_ia'
    and exists (
      select 1
      from unnest(coalesce(job.company_list, '{}'::text[])) as cl(name)
      where lower(cl.name) = lower(coalesce(g.company_name, ''))
    );

  new_processed := greatest(coalesce(job.processed_companies, 0), least(completed_groups, job.total_companies));
  failed_count := coalesce(jsonb_array_length(job.failed_companies), 0);

  if job.status in ('cancelado', 'concluido') then
    return job;
  end if;

  if new_processed >= job.total_companies then
    if failed_count > 0 then
      new_status := 'parcial';
    else
      new_status := 'concluido';
    end if;
  else
    new_status := job.status; -- preserva (em_andamento ou parcial)
  end if;

  -- Update isolado num bloco com EXCEPTION pra não quebrar a transação caso
  -- algum trigger downstream (ex.: trg_payments_historico_guard) reclame de
  -- mudança de status do pagamento. Nesses casos, atualizamos apenas o
  -- contador e deixamos o status como estava.
  begin
    update public.payment_processing_jobs
       set processed_companies = new_processed,
           status = new_status,
           finished_at = case
             when new_processed >= total_companies then coalesce(finished_at, now())
             else finished_at
           end,
           updated_at = now()
     where id = _job_id
    returning * into job;
  exception when others then
    -- Fallback: tenta atualizar só o contador (sem mexer no status).
    begin
      update public.payment_processing_jobs
         set processed_companies = new_processed,
             updated_at = now()
       where id = _job_id
      returning * into job;
    exception when others then
      -- Mesmo o contador deu erro — devolve o job atual sem mudanças.
      select * into job from public.payment_processing_jobs where id = _job_id;
    end;
  end;

  return job;
end;
$$;

grant execute on function public.reconcile_job_progress(uuid) to authenticated, service_role;

-- Backfill: aplica em jobs travados há >5min e em jobs já 'parcial' sem falhas.
-- Cada iteração com EXCEPTION pra que um pagamento problemático não derrube
-- os outros.
do $$
declare
  r record;
begin
  for r in
    select id from public.payment_processing_jobs
    where (status = 'em_andamento' and updated_at < now() - interval '5 minutes')
       or (status = 'parcial' and coalesce(jsonb_array_length(failed_companies), 0) = 0)
  loop
    begin
      perform public.reconcile_job_progress(r.id);
    exception when others then
      raise notice 'reconcile_job_progress falhou para job %: %', r.id, sqlerrm;
    end;
  end loop;
end$$;

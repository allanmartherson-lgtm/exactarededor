
create or replace function public.trg_recompute_payment_on_job_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.recompute_payment_status_from_groups(new.payment_id);
  exception when others then
    -- Não derruba a atualização do job se o recálculo do status do pagamento
    -- esbarrar em uma guarda (ex.: trg_payments_historico_guard recusa
    -- 'lancado' para pagamentos históricos). O lote continua marcado como
    -- concluído/parcial; o pagamento mantém o status que já tinha.
    raise notice 'recompute_payment_status_from_groups falhou: %', sqlerrm;
  end;
  return new;
end;
$$;

-- Conclui o lote de Janeiro 2026 que estava preso (agora 159/159).
update public.payment_processing_jobs
   set status = 'concluido',
       finished_at = coalesce(finished_at, now()),
       updated_at = now()
 where id = '480f734d-08d5-4e83-a57e-6cae5c5af4eb'
   and status = 'em_andamento'
   and processed_companies >= total_companies
   and coalesce(jsonb_array_length(failed_companies), 0) = 0;

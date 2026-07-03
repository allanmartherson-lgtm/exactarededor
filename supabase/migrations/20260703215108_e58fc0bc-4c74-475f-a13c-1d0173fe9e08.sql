create or replace function public.enforce_tvr_reconciliation_item_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_summary jsonb;
  v_period_start date;
  v_period_end date;
  v_selected_ids jsonb;
  v_matched_payment_id text;
  v_item_date date;
begin
  if coalesce(new.source, '') <> 'tasy_vs_repasse' then
    return new;
  end if;

  select r.summary, r.period_start::date, r.period_end::date
    into v_summary, v_period_start, v_period_end
  from public.retroactive_reconciliations r
  where r.id = new.reconciliation_id;

  if coalesce(v_summary->>'mode', '') <> 'tasy_vs_repasse' then
    return new;
  end if;

  v_selected_ids := coalesce(v_summary->'selected_payment_ids', '[]'::jsonb);
  if jsonb_typeof(v_selected_ids) <> 'array' or jsonb_array_length(v_selected_ids) = 0 then
    raise exception 'TASY vs Repasse exige lote selecionado antes de salvar itens da apuração.'
      using errcode = 'check_violation',
            hint = 'Reprocesse a apuração após selecionar um ou mais lotes.';
  end if;

  v_matched_payment_id := nullif(new.raw->'tvr_result'->>'matched_payment_id', '');
  v_item_date := new.procedure_date::date;

  if v_item_date is null then
    raise exception 'Item TASY vs Repasse sem data de procedimento não pode ser salvo.'
      using errcode = 'check_violation',
            hint = 'Mapeie a coluna Data do procedimento e reprocesse dentro do período selecionado.';
  end if;

  if v_item_date < v_period_start or v_item_date > v_period_end then
    raise exception 'Item TASY vs Repasse fora do período da apuração: % não está entre % e %.', v_item_date, v_period_start, v_period_end
      using errcode = 'check_violation',
            hint = 'A apuração deve ser reprocessada com itens filtrados pelo período e pelos lotes selecionados.';
  end if;

  if v_matched_payment_id is not null and not (v_selected_ids ? v_matched_payment_id) then
    raise exception 'Item TASY vs Repasse aponta para lote fora do escopo selecionado: %.', v_matched_payment_id
      using errcode = 'check_violation',
            hint = 'Recarregue os pagamentos do Passo 2 para usar somente os lotes selecionados.';
  end if;

  return new;
end;
$$;
-- Enforce que apurações TASY vs Repasse tenham ao menos um lote fixado.
-- Sem isso, o motor cai no fallback por competência do mês e mistura outros
-- lotes na conta — regra combinada com o time do produto.
create or replace function public.enforce_tvr_selected_payment_ids()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_mode text;
  v_ids jsonb;
begin
  v_mode := coalesce(new.summary->>'mode', '');
  if v_mode <> 'tasy_vs_repasse' then
    return new;
  end if;

  v_ids := coalesce(new.summary->'selected_payment_ids', '[]'::jsonb);
  if jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) = 0 then
    raise exception 'TASY vs Repasse exige ao menos um lote (selected_payment_ids) no escopo da apuração.'
      using errcode = 'check_violation',
            hint = 'Selecione um ou mais lotes no wizard/passo 2 antes de salvar a apuração.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_tvr_selected_payment_ids on public.retroactive_reconciliations;
create trigger trg_enforce_tvr_selected_payment_ids
before insert or update of summary
on public.retroactive_reconciliations
for each row
execute function public.enforce_tvr_selected_payment_ids();
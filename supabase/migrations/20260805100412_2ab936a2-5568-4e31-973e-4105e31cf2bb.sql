insert into public.payment_models (code,label,description,sort_order,active,calc_strategy,allow_mixed_item_types)
select 'hora_trabalhada','Hora trabalhada','Pagamento por hora efetivamente trabalhada',25,true,'rules',true
where not exists (select 1 from public.payment_models where code = 'hora_trabalhada');

alter table public.agreement_registrations
  add column if not exists payment_model_ids uuid[] not null default '{}',
  add column if not exists minimo_garantido_ativo boolean not null default false,
  add column if not exists minimo_garantido_valor numeric,
  add column if not exists minimo_garantido_escopo text,
  add column if not exists minimo_garantido_periodicidade text,
  add column if not exists minimo_garantido_base text,
  add column if not exists calculation_draft jsonb not null default '{}'::jsonb;
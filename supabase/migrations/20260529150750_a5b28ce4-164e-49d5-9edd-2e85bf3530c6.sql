create table if not exists public.company_access_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  resource text not null,
  resource_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_access_log_company on public.company_access_log(company_id, created_at desc);
create index if not exists idx_company_access_log_resource on public.company_access_log(resource, resource_id, created_at desc);

grant select, insert on public.company_access_log to authenticated;
grant all on public.company_access_log to service_role;

alter table public.company_access_log enable row level security;

create policy "company can insert own access log"
on public.company_access_log
for insert to authenticated
with check (
  user_id = auth.uid()
  and company_id in (
    select company_id from public.company_portal_users
    where user_id = auth.uid() and active = true
  )
);
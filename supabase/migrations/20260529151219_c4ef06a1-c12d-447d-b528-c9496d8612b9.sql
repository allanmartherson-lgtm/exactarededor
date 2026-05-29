create or replace function public.is_company_portal_user(_user_id uuid, _company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_portal_users
    where user_id = _user_id
      and company_id = _company_id
      and active = true
  )
$$;

revoke all on function public.is_company_portal_user(uuid, uuid) from public;
grant execute on function public.is_company_portal_user(uuid, uuid) to authenticated, service_role;

drop policy if exists invoices_view_company_portal on public.invoices;

create policy invoices_view_company_portal
on public.invoices
for select
to authenticated
using (
  sent_at is not null
  and status <> 'cancelada'
  and public.is_company_portal_user(auth.uid(), company_id)
);

grant select on public.invoices to authenticated;
-- Clients must never receive internal costs. project_money is readable by the project's client
-- (quote, paid, moneyDue are theirs to see), so internal figures move to project_costs,
-- which only staff with finance access can read. Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.project_costs (
  id text primary key references public.projects(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- move internal figures out of the client-readable row
insert into public.project_costs (id, data)
select id, jsonb_strip_nulls(jsonb_build_object('budget', data->'budget', 'spent', data->'spent', 'cf', data->'cf'))
from public.project_money
on conflict (id) do update set data = public.project_costs.data || excluded.data;

update public.project_money set data = data - 'budget' - 'spent' - 'cf';

alter table public.project_costs enable row level security;
drop policy if exists hub_select on public.project_costs;
drop policy if exists hub_insert on public.project_costs;
drop policy if exists hub_update on public.project_costs;
drop policy if exists hub_delete on public.project_costs;
-- staff only: clients are excluded by is_staff(), finance access by fin_sees()
create policy hub_select on public.project_costs for select using (public.is_staff() and public.fin_sees(id));
create policy hub_insert on public.project_costs for insert with check (public.is_owner() or (public.is_staff() and public.fin_sees(id)));
create policy hub_update on public.project_costs for update using (public.is_owner() or (public.is_staff() and public.fin_sees(id)));
create policy hub_delete on public.project_costs for delete using (public.is_owner());
grant select, insert, update, delete on public.project_costs to authenticated;

do $$ begin alter publication supabase_realtime add table public.project_costs; exception when others then null; end $$;

-- project_money: the client's own rows stay readable, but now carry only quote, paid and moneyDue.
-- The app keeps the same policy; the internal keys are simply no longer stored there.

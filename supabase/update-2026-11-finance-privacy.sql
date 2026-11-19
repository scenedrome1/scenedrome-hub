-- Finance privacy: finance list membership, per-project money access, project money in its own table, finance books
-- 1) finance permissions only count for people the owner added to the finance list
create or replace function public.has_perm(k text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' or (role not in ('client','partner') and coalesce((access->>k)::boolean, false)
                   and (k not like 'fin.%' or k = 'fin.expenses' or coalesce((access->>'fin.member')::boolean, false)))
                   from profiles where id = auth.uid() and not suspended), false) $$;

-- 2) who may know a project's money: owners, the project's own client, and finance-list members who are on the project
--    or were given that project (or all projects) by the owner
create or replace function public.fin_sees(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (select 1 from projects p where p.id = pid and p.client = auth.uid()::text)
      or (public.is_staff() and public.has_perm('fin.member') and (
            public.has_perm('fin.allProjects') or public.has_perm('fin.p.' || pid)
            or exists (select 1 from projects p where p.id = pid and auth.uid()::text = any(p.members)))) $$;

-- 3) only owners change anyone's finance access
create or replace function public.protect_fin_access() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_owner() then return new; end if;
  new.access := coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(new.access,'{}'::jsonb)) where k not like 'fin.%' or k = 'fin.expenses'), '{}'::jsonb)
             || coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(old.access,'{}'::jsonb)) where k like 'fin.%' and k <> 'fin.expenses'), '{}'::jsonb);
  return new;
end $$;
drop trigger if exists zz_protect_fin_access on public.profiles;
create trigger zz_protect_fin_access before update on public.profiles for each row execute function public.protect_fin_access();

-- 4) project money moves out of the project row
create table if not exists public.project_money (id text primary key references public.projects(id) on delete cascade, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
alter table public.project_money enable row level security;
drop policy if exists hub_select on public.project_money; drop policy if exists hub_insert on public.project_money;
drop policy if exists hub_update on public.project_money; drop policy if exists hub_delete on public.project_money;
create policy hub_select on public.project_money for select using (public.fin_sees(id));
create policy hub_insert on public.project_money for insert with check (public.is_owner() or (public.is_staff() and public.fin_sees(id)));
create policy hub_update on public.project_money for update using (public.is_owner() or (public.is_staff() and public.fin_sees(id)));
create policy hub_delete on public.project_money for delete using (public.is_owner());
grant select, insert, update, delete on public.project_money to authenticated;

insert into public.project_money (id, data)
select id, jsonb_strip_nulls(jsonb_build_object('quote', data->'quote', 'paid', data->'paid', 'budget', data->'budget', 'spent', data->'spent', 'cf', data->'cf', 'moneyDue', data->'moneyDue'))
from public.projects
on conflict (id) do update set data = public.project_money.data || excluded.data;
update public.projects set data = data - 'quote' - 'paid' - 'budget' - 'spent' - 'cf' - 'moneyDue';

-- 5) money entries and published Cashflow rows follow the same rule
drop policy if exists hub_select on public.money_entries;
create policy hub_select on public.money_entries for select using (by_user = auth.uid()::text or public.is_owner()
  or (public.is_staff() and public.fin_sees(project_id)));
drop policy if exists hub_select on public.fin_rows;
create policy hub_select on public.fin_rows for select using (public.is_owner() or auth.uid()::text = any(share)
  or (public.is_staff() and link is not null and public.fin_sees(link)));
drop policy if exists hub_select on public.expenses;
create policy hub_select on public.expenses for select using (by_user = auth.uid()::text or public.is_owner() or public.has_perm('fin.office'));

-- 6) the books: manpower, office cashflow, assets, subscriptions — each opened by its own permission
create table if not exists public.fin_books (id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
alter table public.fin_books enable row level security;
create or replace function public.fin_book_ok(b text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or (public.is_staff() and public.has_perm(case b when 'salaries' then 'fin.salaries' when 'office' then 'fin.office'
                                                                         when 'assets' then 'fin.assets' when 'subs' then 'fin.subs' else 'fin.none' end)) $$;
drop policy if exists hub_select on public.fin_books; drop policy if exists hub_insert on public.fin_books;
drop policy if exists hub_update on public.fin_books; drop policy if exists hub_delete on public.fin_books;
create policy hub_select on public.fin_books for select using (public.fin_book_ok(id));
create policy hub_insert on public.fin_books for insert with check (public.fin_book_ok(id));
create policy hub_update on public.fin_books for update using (public.fin_book_ok(id));
create policy hub_delete on public.fin_books for delete using (public.is_owner());
grant select, insert, update, delete on public.fin_books to authenticated;

do $$ begin alter publication supabase_realtime add table public.project_money; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.fin_books; exception when others then null; end $$;

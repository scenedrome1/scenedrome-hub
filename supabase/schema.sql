-- SCENEDROME Hub · database schema (run once in Supabase → SQL Editor)
-- Every table is protected by row level security: people only receive the rows the owner allows.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'artist',          -- owner | manager | producer | artist | client | partner
  job text not null default 'freelancer',
  access jsonb not null default '{}'::jsonb,     -- per-person permission switches
  suspended boolean not null default false,
  data jsonb not null default '{}'::jsonb,       -- name, title, bio, photo, status …
  created_at timestamptz not null default now()
);
create table if not exists public.projects (id text primary key, producer text, client text, members text[] not null default '{}', data jsonb not null, updated_at timestamptz default now());
create table if not exists public.tasks (id text primary key, project_id text not null, assignee text, data jsonb not null);
create table if not exists public.messages (id text primary key, project_id text not null, ch text not null, user_id text not null, data jsonb not null, created_at timestamptz default now());
create table if not exists public.notifications (id text primary key, to_user text not null, data jsonb not null, created_at timestamptz default now());
create table if not exists public.leaves (id text primary key, user_id text not null, data jsonb not null);
create table if not exists public.files (id text primary key, project_id text not null, share text[] not null default '{team}', data jsonb not null);
create table if not exists public.devices (id text primary key, project_id text, data jsonb not null);
create table if not exists public.marketing (id text primary key, project_id text, data jsonb not null);
create table if not exists public.expenses (id text primary key, by_user text not null, project_id text, data jsonb not null);
create table if not exists public.money_entries (id text primary key, by_user text not null, project_id text not null, status text not null default 'submitted', data jsonb not null);
create table if not exists public.evals (id text primary key, user_id text not null, data jsonb not null);
create table if not exists public.fin_rows (id text primary key, link text, share text[] not null default '{}', data jsonb not null);
create table if not exists public.fin_private (id text primary key, data jsonb not null);
create table if not exists public.fin_meta (id text primary key, data jsonb not null);
create table if not exists public.cashflow_docs (path text primary key, data jsonb not null, updated_at timestamptz default now());

create index if not exists tasks_project on public.tasks(project_id);
create index if not exists messages_project on public.messages(project_id);
create index if not exists notifications_to on public.notifications(to_user);
create index if not exists files_project on public.files(project_id);
create index if not exists entries_project on public.money_entries(project_id);

-- ---------- helpers (run as definer so they can read profiles/projects without recursion) ----------
create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and not suspended $$;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from profiles where id = auth.uid() and not suspended), false) $$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role not in ('client','partner') from profiles where id = auth.uid() and not suspended), false) $$;
create or replace function public.has_perm(k text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' or (role not in ('client','partner') and coalesce((access->>k)::boolean, false))
                   from profiles where id = auth.uid() and not suspended), false) $$;
create or replace function public.can_see_project(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (select 1 from projects p where p.id = pid
         and (auth.uid()::text = any(p.members) or public.has_perm('proj.all'))) $$;
create or replace function public.produces(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects p where p.id = pid and p.producer = auth.uid()::text) $$;

-- first signed-in account becomes the owner (only while no owner exists)
create or replace function public.hub_bootstrap(p_data jsonb) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from profiles where role = 'owner') then return false; end if;
  insert into profiles (id, email, role, job, access, data)
  select u.id, u.email, 'owner', 'founder', '{}'::jsonb, p_data from auth.users u where u.id = auth.uid()
  on conflict (id) do update set role = 'owner', job = 'founder';
  return true;
end $$;

-- people can edit their own profile, but only the owner can change role, job, access or suspension;
-- other staff may only touch studio fields (kudos, leave, evaluation, title, department)
create or replace function public.protect_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_owner() then return new; end if;
  new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended; new.email := old.email;
  if auth.uid() <> old.id then
    new.data := old.data
      || jsonb_strip_nulls(jsonb_build_object('kudos', new.data->'kudos'))
      || case when public.has_perm('team.leaves') then jsonb_strip_nulls(jsonb_build_object('leave', new.data->'leave')) else '{}'::jsonb end
      || case when public.has_perm('team.evaluate') then jsonb_strip_nulls(jsonb_build_object('perf', new.data->'perf', 'overtime', new.data->'overtime')) else '{}'::jsonb end
      || case when public.has_perm('team.studioInfo') then jsonb_strip_nulls(jsonb_build_object('title', new.data->'title', 'dept', new.data->'dept', 'joined', new.data->'joined', 'leave', new.data->'leave')) else '{}'::jsonb end;
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before update on public.profiles for each row execute function public.protect_profile();

-- ---------- row level security ----------
do $$ declare t text; begin
  foreach t in array array['profiles','projects','tasks','messages','notifications','leaves','files','devices','marketing','expenses','money_entries','evals','fin_rows','fin_private','fin_meta','cashflow_docs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists hub_select on public.%I', t);
    execute format('drop policy if exists hub_insert on public.%I', t);
    execute format('drop policy if exists hub_update on public.%I', t);
    execute format('drop policy if exists hub_delete on public.%I', t);
  end loop; end $$;

create policy hub_select on public.profiles for select using (id = auth.uid() or public.is_staff() or role not in ('client','partner'));
create policy hub_update on public.profiles for update using (id = auth.uid() or public.is_staff());

create policy hub_select on public.projects for select using (public.can_see_project(id));
create policy hub_insert on public.projects for insert with check (public.has_perm('proj.create'));
create policy hub_update on public.projects for update using (public.is_staff() and public.can_see_project(id));
create policy hub_delete on public.projects for delete using (public.is_owner());

create policy hub_select on public.tasks for select using (public.can_see_project(project_id) and (public.is_staff() or assignee = auth.uid()::text));
create policy hub_insert on public.tasks for insert with check (public.is_staff() and public.can_see_project(project_id));
create policy hub_update on public.tasks for update using (public.can_see_project(project_id) and (public.is_staff() or assignee = auth.uid()::text));
create policy hub_delete on public.tasks for delete using (public.is_staff() and public.can_see_project(project_id));

create policy hub_select on public.messages for select using (public.can_see_project(project_id) and (
  (ch = 'team' and public.my_role() <> 'client') or (ch = 'client' and (public.my_role() = 'client' or public.has_perm('proj.clientThread')))));
create policy hub_insert on public.messages for insert with check (user_id = auth.uid()::text and public.can_see_project(project_id) and (
  (ch = 'team' and public.my_role() <> 'client') or (ch = 'client' and (public.my_role() = 'client' or public.has_perm('proj.clientThread')))));
create policy hub_update on public.messages for update using (public.can_see_project(project_id));
create policy hub_delete on public.messages for delete using (public.is_owner());

create policy hub_select on public.notifications for select using (to_user = auth.uid()::text);
create policy hub_insert on public.notifications for insert with check (auth.uid() is not null);
create policy hub_update on public.notifications for update using (to_user = auth.uid()::text);
create policy hub_delete on public.notifications for delete using (to_user = auth.uid()::text);

create policy hub_select on public.leaves for select using (user_id = auth.uid()::text or public.has_perm('team.view') or public.has_perm('team.leaves'));
create policy hub_insert on public.leaves for insert with check (user_id = auth.uid()::text);
create policy hub_update on public.leaves for update using (public.has_perm('team.leaves'));

create policy hub_select on public.files for select using (public.can_see_project(project_id) and (public.my_role() <> 'client' or 'client' = any(share)));
create policy hub_insert on public.files for insert with check (public.can_see_project(project_id));
create policy hub_update on public.files for update using (public.is_staff() and public.can_see_project(project_id));
create policy hub_delete on public.files for delete using (public.is_staff() and public.can_see_project(project_id));

create policy hub_select on public.devices for select using (public.is_staff());
create policy hub_insert on public.devices for insert with check (public.has_perm('storage.manage'));
create policy hub_update on public.devices for update using (public.has_perm('storage.manage'));
create policy hub_delete on public.devices for delete using (public.has_perm('storage.manage'));

create policy hub_select on public.marketing for select using (public.has_perm('mkt.view') or public.has_perm('mkt.manage'));
create policy hub_insert on public.marketing for insert with check (public.is_staff());
create policy hub_update on public.marketing for update using (public.has_perm('mkt.manage'));
create policy hub_delete on public.marketing for delete using (public.has_perm('mkt.manage'));

create policy hub_select on public.expenses for select using (by_user = auth.uid()::text or public.is_owner() or public.has_perm('fin.salaries'));
create policy hub_insert on public.expenses for insert with check (by_user = auth.uid()::text and public.has_perm('fin.expenses'));
create policy hub_update on public.expenses for update using (public.is_owner());

create policy hub_select on public.money_entries for select using (by_user = auth.uid()::text or public.is_owner()
  or (public.has_perm('fin.projectEntry') and (public.has_perm('proj.all') or public.produces(project_id))));
create policy hub_insert on public.money_entries for insert with check (by_user = auth.uid()::text and public.has_perm('fin.projectEntry'));
create policy hub_update on public.money_entries for update using (public.is_owner() or (by_user = auth.uid()::text and status <> 'recorded'));
create policy hub_delete on public.money_entries for delete using (public.is_owner() or (by_user = auth.uid()::text and status <> 'recorded'));

create policy hub_select on public.evals for select using (user_id = auth.uid()::text or public.has_perm('team.evaluate'));
create policy hub_insert on public.evals for insert with check (public.has_perm('team.evaluate'));

create policy hub_select on public.fin_rows for select using (public.is_owner() or auth.uid()::text = any(share) or public.has_perm('fin.budgetsAll')
  or (public.has_perm('fin.receivables') and public.has_perm('proj.all'))
  or exists (select 1 from public.projects p where p.id = link and (
       (public.has_perm('fin.budgetsOwn') and p.producer = auth.uid()::text) or (public.has_perm('fin.receivables') and auth.uid()::text = any(p.members)))));
create policy hub_insert on public.fin_rows for insert with check (public.is_owner());
create policy hub_update on public.fin_rows for update using (public.is_owner());
create policy hub_delete on public.fin_rows for delete using (public.is_owner());

create policy hub_select on public.fin_private for select using (public.is_owner() or public.has_perm('fin.salaries'));
create policy hub_insert on public.fin_private for insert with check (public.is_owner());
create policy hub_update on public.fin_private for update using (public.is_owner());

create policy hub_select on public.fin_meta for select using (public.is_owner() or public.has_perm('fin.overview'));
create policy hub_insert on public.fin_meta for insert with check (public.is_owner());
create policy hub_update on public.fin_meta for update using (public.is_owner());

-- the owner's Cashflow books (already encrypted with the Cashflow password before they arrive here)
create policy hub_select on public.cashflow_docs for select using (public.is_owner());
create policy hub_insert on public.cashflow_docs for insert with check (public.is_owner());
create policy hub_update on public.cashflow_docs for update using (public.is_owner());
create policy hub_delete on public.cashflow_docs for delete using (public.is_owner());

-- live updates (notifications, chat, tasks …)
do $$ declare t text; begin
  foreach t in array array['profiles','projects','tasks','messages','notifications','leaves','files','devices','marketing','expenses','money_entries','fin_rows','fin_meta'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when duplicate_object then null; end;
  end loop; end $$;

-- branding & studio settings (readable before sign-in so the login page is branded; only the owner edits)
create table if not exists public.settings (id text primary key, data jsonb not null, updated_at timestamptz default now());
alter table public.settings enable row level security;
drop policy if exists hub_select on public.settings; drop policy if exists hub_insert on public.settings; drop policy if exists hub_update on public.settings;
create policy hub_select on public.settings for select using (true);
create policy hub_insert on public.settings for insert with check (public.is_owner());
create policy hub_update on public.settings for update using (public.is_owner());
grant select on public.settings to anon;
do $$ begin begin alter publication supabase_realtime add table public.settings; exception when duplicate_object then null; end; end $$;

-- SCENEDROME Hub · update: client relationship notes (internal) + client profiles editable by management. Run once; safe to run again.
create table if not exists public.client_notes (id text primary key, data jsonb not null default '{}'::jsonb, updated_at timestamptz default now());
alter table public.client_notes enable row level security;
drop policy if exists hub_select on public.client_notes; drop policy if exists hub_insert on public.client_notes;
drop policy if exists hub_update on public.client_notes; drop policy if exists hub_delete on public.client_notes;
create policy hub_select on public.client_notes for select using (public.is_staff() and (public.is_owner() or public.my_role() = 'manager' or public.has_perm('clients.view')));
create policy hub_insert on public.client_notes for insert with check (public.is_owner() or public.my_role() = 'manager' or public.has_perm('clients.manage'));
create policy hub_update on public.client_notes for update using (public.is_owner() or public.my_role() = 'manager' or public.has_perm('clients.manage'));
create policy hub_delete on public.client_notes for delete using (public.is_owner());
grant select, insert, update, delete on public.client_notes to authenticated;
do $$ begin alter publication supabase_realtime add table public.client_notes; exception when others then null; end $$;

create or replace function public.protect_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the studio account (main owner) can change anything
  if public.is_main_owner() then return new; end if;
  -- other owners: anything on non-owners, and their own details — never another owner, never their own role/access
  if public.is_owner() then
    if old.id = auth.uid() then
      new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended; new.email := old.email;
      return new;
    end if;
    if old.role = 'owner' then
      new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended; new.email := old.email;
      new.data := old.data || jsonb_strip_nulls(jsonb_build_object('kudos', new.data->'kudos'));
      return new;
    end if;
    if new.role = 'owner' then new.role := old.role; end if;
    new.email := old.email;
    return new;
  end if;
  new.email := old.email;
  -- nobody else touches owners (except sending kudos)
  if old.role = 'owner' then
    new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended;
    new.data := old.data || jsonb_strip_nulls(jsonb_build_object('kudos', new.data->'kudos'));
    return new;
  end if;
  -- management and client managers keep client & partner profiles up to date (offers, questions, hold), never their role or access
  if auth.uid() <> old.id and old.role in ('client','partner') and (public.my_role() = 'manager' or public.has_perm('clients.manage') or public.has_perm('admin.users')) then
    new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended;
    return new;
  end if;
  if auth.uid() <> old.id and public.has_perm('admin.users') then
    if new.role = 'owner' then new.role := old.role; end if;
    return new;
  end if;
  new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended;
  if auth.uid() <> old.id then
    if public.has_perm('people.add') then
      new.data := old.data || (new.data - 'hist') || jsonb_build_object('hist', coalesce(new.data->'hist', old.data->'hist'));
      return new;
    end if;
    new.data := old.data
      || jsonb_strip_nulls(jsonb_build_object('kudos', new.data->'kudos'))
      || case when public.has_perm('team.leaves') then jsonb_strip_nulls(jsonb_build_object('leave', new.data->'leave')) else '{}'::jsonb end
      || case when public.has_perm('team.evaluate') then jsonb_strip_nulls(jsonb_build_object('perf', new.data->'perf', 'overtime', new.data->'overtime')) else '{}'::jsonb end
      || case when public.has_perm('team.studioInfo') then jsonb_strip_nulls(jsonb_build_object('title', new.data->'title', 'dept', new.data->'dept', 'joined', new.data->'joined', 'leave', new.data->'leave')) else '{}'::jsonb end;
  end if;
  return new;
end $$;

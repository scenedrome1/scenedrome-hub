-- SCENEDROME Hub · update: Edit suites & grading rooms booking. Run once in Supabase → SQL Editor; safe to run again.
create table if not exists public.rooms (id text primary key, data jsonb not null);
create table if not exists public.bookings (
  id text primary key, project_id text, by_user text not null, status text not null default 'requested',
  start_ts bigint not null, end_ts bigint not null, data jsonb not null, created_at timestamptz default now());
create index if not exists bookings_time on public.bookings(start_ts);
create index if not exists bookings_project on public.bookings(project_id);
alter table public.rooms enable row level security;
alter table public.bookings enable row level security;
drop policy if exists hub_select on public.rooms; drop policy if exists hub_insert on public.rooms;
drop policy if exists hub_update on public.rooms; drop policy if exists hub_delete on public.rooms;
drop policy if exists hub_select on public.bookings; drop policy if exists hub_insert on public.bookings;
drop policy if exists hub_update on public.bookings; drop policy if exists hub_delete on public.bookings;

-- rooms: staff see them, only people with "Manage the room schedule" (and owners) change them
create policy hub_select on public.rooms for select using (public.is_staff());
create policy hub_insert on public.rooms for insert with check (public.has_perm('rooms.manage'));
create policy hub_update on public.rooms for update using (public.has_perm('rooms.manage'));
create policy hub_delete on public.rooms for delete using (public.has_perm('rooms.manage'));

-- bookings: anyone with a rooms permission sees the schedule; requesters can only create "requested"
-- bookings for projects they can see; only managers confirm, decline, move or delete
create policy hub_select on public.bookings for select using (public.is_staff() and
  (public.has_perm('rooms.view') or public.has_perm('rooms.request') or public.has_perm('rooms.manage') or by_user = auth.uid()::text));
create policy hub_insert on public.bookings for insert with check (by_user = auth.uid()::text and
  (public.has_perm('rooms.manage') or (status = 'requested' and public.has_perm('rooms.request') and project_id is not null and public.can_see_project(project_id))));
create policy hub_update on public.bookings for update using (public.has_perm('rooms.manage') or by_user = auth.uid()::text)
  with check (public.has_perm('rooms.manage') or (by_user = auth.uid()::text and status in ('requested','cancelled') and project_id is not null and public.can_see_project(project_id)));
create policy hub_delete on public.bookings for delete using (public.has_perm('rooms.manage'));

grant select, insert, update, delete on public.rooms, public.bookings to authenticated, service_role;
do $$ declare t text; begin foreach t in array array['rooms','bookings'] loop
  begin execute format('alter publication supabase_realtime add table public.%I', t); exception when duplicate_object then null; end;
end loop; end $$;
-- Then, in the Hub: Users & access → open a person → switch on "See the room schedule", "Request rooms" or "Manage the room schedule".

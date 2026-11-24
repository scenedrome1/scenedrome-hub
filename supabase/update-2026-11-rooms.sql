-- Rooms & bookings tables for the Hub (edit suites, grading rooms, creative space).
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists public.rooms (
  id text primary key,
  data jsonb not null
);

create table if not exists public.bookings (
  id text primary key,
  project_id text,
  by_user text,
  status text,
  start_ts text,
  end_ts text,
  data jsonb not null
);

alter table public.rooms enable row level security;
alter table public.bookings enable row level security;

drop policy if exists rooms_select on public.rooms;
drop policy if exists rooms_insert on public.rooms;
drop policy if exists rooms_update on public.rooms;
drop policy if exists rooms_delete on public.rooms;
create policy rooms_select on public.rooms for select using (public.is_staff());
create policy rooms_insert on public.rooms for insert with check (public.has_perm('rooms.manage'));
create policy rooms_update on public.rooms for update using (public.has_perm('rooms.manage'));
create policy rooms_delete on public.rooms for delete using (public.has_perm('rooms.manage'));

drop policy if exists bookings_select on public.bookings;
drop policy if exists bookings_insert on public.bookings;
drop policy if exists bookings_update on public.bookings;
drop policy if exists bookings_delete on public.bookings;
create policy bookings_select on public.bookings for select using (public.is_staff());
create policy bookings_insert on public.bookings for insert with check (public.has_perm('rooms.request') or public.has_perm('rooms.manage'));
create policy bookings_update on public.bookings for update using (public.has_perm('rooms.request') or public.has_perm('rooms.manage'));
create policy bookings_delete on public.bookings for delete using (public.has_perm('rooms.manage'));

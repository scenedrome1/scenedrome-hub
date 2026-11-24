-- SCENEDROME Hub — service catalogue (prices) writable by staff
-- The catalogue lives in settings row id = 'catalog'. Staff can read it (existing select policy)
-- and create/update that one row. Brand settings stay owner-only.
-- Run once in the Supabase SQL editor.

drop policy if exists hub_catalog_insert on public.settings;
drop policy if exists hub_catalog_update on public.settings;

create policy hub_catalog_insert on public.settings for insert
  with check (id = 'catalog' and public.is_staff());

create policy hub_catalog_update on public.settings for update
  using (id = 'catalog' and public.is_staff())
  with check (id = 'catalog' and public.is_staff());

-- SCENEDROME Hub · update: phone app push notifications
-- Run once in Supabase → SQL Editor, after deploying the "hub-push" Edge Function. Safe to run again.

-- each phone / browser that turned notifications on
create table if not exists public.push_subs (id text primary key, user_id text not null, data jsonb not null, created_at timestamptz default now());
create index if not exists push_subs_user on public.push_subs(user_id);
alter table public.push_subs enable row level security;
drop policy if exists hub_select on public.push_subs; drop policy if exists hub_insert on public.push_subs;
drop policy if exists hub_update on public.push_subs; drop policy if exists hub_delete on public.push_subs;
create policy hub_select on public.push_subs for select using (user_id = auth.uid()::text);
create policy hub_insert on public.push_subs for insert with check (user_id = auth.uid()::text);
create policy hub_update on public.push_subs for update using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text);
create policy hub_delete on public.push_subs for delete using (user_id = auth.uid()::text);

-- the push signing keys (created by the function itself; nobody can read them from the app)
create table if not exists public.push_config (id text primary key, data jsonb not null);
alter table public.push_config enable row level security;

-- every new notification is sent to the person's phones, once
alter table public.notifications add column if not exists pushed_at timestamptz;
create extension if not exists pg_net;
create or replace function public.hub_push_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://oaeultdysisztqogbtak.supabase.co/functions/v1/hub-push',
    body := jsonb_build_object('id', new.id),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  return new;
end $$;
drop trigger if exists hub_push_notify on public.notifications;
create trigger hub_push_notify after insert on public.notifications for each row execute function public.hub_push_notify();

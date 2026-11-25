-- OneDrive media bridge: private token table (service role only)
create table if not exists public.media_auth (id int primary key default 1, refresh_token text, account text, updated_at timestamptz default now(), constraint one_row check (id=1));
alter table public.media_auth enable row level security;
revoke all on public.media_auth from anon, authenticated;
grant select, insert, update, delete on public.media_auth to service_role;

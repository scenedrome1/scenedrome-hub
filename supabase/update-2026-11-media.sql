-- OneDrive media bridge: private token table (service role only)
create table if not exists public.media_auth (id int primary key default 1, refresh_token text, account text, updated_at timestamptz default now(), constraint one_row check (id=1));
alter table public.media_auth enable row level security;
revoke all on public.media_auth from anon, authenticated;
grant select, insert, update, delete on public.media_auth to service_role;

-- Media library: virtual folders + files (the bytes live in OneDrive; written only by the hub-media function)
create table if not exists public.media_projects (project_id text primary key references public.projects(id) on delete cascade, item_id text not null);
create table if not exists public.media_folders (id text primary key, project_id text not null references public.projects(id) on delete cascade, parent text, name text not null, access jsonb not null default '{}'::jsonb, "by" text, ts bigint not null default (extract(epoch from now())*1000)::bigint);
create table if not exists public.media_files (id text primary key, project_id text not null references public.projects(id) on delete cascade, folder_id text, group_id text not null, ver int not null default 1, name text not null, item_id text not null, mime text, size bigint, "by" text, ts bigint not null default (extract(epoch from now())*1000)::bigint);
create index if not exists media_files_p on public.media_files (project_id);
create index if not exists media_folders_p on public.media_folders (project_id);
create or replace function public.media_ok(pid text, fid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.review_inhouse() and (public.is_owner() or exists (select 1 from projects p where p.id = pid and auth.uid()::text = any(p.members)))
    and (fid is null or exists (select 1 from media_folders f where f.id = fid and f.project_id = pid
         and (public.is_owner() or f."by" = auth.uid()::text or coalesce(jsonb_array_length(f.access->'users'),0) = 0 or (f.access->'users') ? auth.uid()::text))) $$;
alter table public.media_projects enable row level security;
alter table public.media_folders enable row level security;
alter table public.media_files enable row level security;
revoke all on public.media_projects from anon, authenticated;
grant select on public.media_folders, public.media_files to authenticated;
grant select, insert, update, delete on public.media_projects, public.media_folders, public.media_files to service_role;
drop policy if exists hub_select on public.media_folders;
drop policy if exists hub_select on public.media_files;
create policy hub_select on public.media_folders for select using (public.media_ok(project_id, id));
create policy hub_select on public.media_files for select using (public.media_ok(project_id, folder_id));

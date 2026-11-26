-- Review library: mirrors (a clip shown in more than one folder — same file, same versions, same comments)
create table if not exists public.media_mirrors (
  id text primary key,
  project_id text not null,
  group_id text not null,
  folder_id text not null,
  "by" text,
  ts bigint,
  unique (group_id, folder_id));
create index if not exists media_mirrors_proj on public.media_mirrors (project_id);
alter table public.media_mirrors enable row level security;
grant select on public.media_mirrors to authenticated;
grant select, insert, update, delete on public.media_mirrors to service_role;
drop policy if exists hub_select on public.media_mirrors;
create policy hub_select on public.media_mirrors for select using (public.media_ok(project_id, folder_id));
drop policy if exists hub_select on public.media_files;
create policy hub_select on public.media_files for select using (
  public.media_ok(project_id, folder_id)
  or exists (select 1 from public.media_mirrors m where m.group_id = media_files.group_id and public.media_ok(m.project_id, m.folder_id)));

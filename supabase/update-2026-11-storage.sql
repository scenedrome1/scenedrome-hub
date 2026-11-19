-- SCENEDROME Hub · update: private file storage for attachments up to 50 MB (run once; safe to run again)
insert into storage.buckets (id, name, public, file_size_limit)
values ('hub', 'hub', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = 52428800;

-- who can open a stored file: people on its project; both people of a direct-message pair; staff for misc
create or replace function public.can_see_object(obj text) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when split_part(obj, '/', 1) = 'dm' then position(auth.uid()::text in split_part(obj, '/', 2)) > 0
    when split_part(obj, '/', 1) = 'misc' then public.is_staff()
    else public.can_see_project(split_part(obj, '/', 1)) end $$;

drop policy if exists hub_files_read on storage.objects;
drop policy if exists hub_files_write on storage.objects;
drop policy if exists hub_files_delete on storage.objects;
create policy hub_files_read on storage.objects for select to authenticated using (bucket_id = 'hub' and public.can_see_object(name));
create policy hub_files_write on storage.objects for insert to authenticated with check (bucket_id = 'hub' and public.can_see_object(name));
create policy hub_files_delete on storage.objects for delete to authenticated using (bucket_id = 'hub' and (owner_id = auth.uid()::text or public.is_owner()));

-- Review library: access follows the folder (and its sub-folders) only, never the folders above it.
create or replace function public.media_mgr(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
    or public.is_general_manager()
    or exists (select 1 from projects p where p.id = pid and p.producer = auth.uid()::text) $$;

-- a folder is open to you when you (or nothing above it that lists people) are on its nearest list of people
create or replace function public.media_fok(pid text, fid text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare cur text := fid; f record; n int := 0;
begin
  if fid is null then return true; end if;
  if public.media_mgr(pid) then return true; end if;
  while cur is not null and n < 30 loop
    select * into f from media_folders where id = cur and project_id = pid;
    if not found then return false; end if;
    if coalesce(jsonb_array_length(f.access->'users'),0) > 0 then return (f.access->'users') ? auth.uid()::text; end if;
    cur := f.parent; n := n + 1;
  end loop;
  return true;
end $$;

create or replace function public.media_ok(pid text, fid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.review_inhouse() and (public.is_owner() or public.media_mgr(pid) or exists (select 1 from projects p where p.id = pid and auth.uid()::text = any(p.members)))
    and public.media_fok(pid, fid) $$;

-- comments and replies: only people who can open that review (sent to them, or access to the folder its files are in)
create or replace function public.review_ok(pid text, vid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.media_mgr(pid) or exists (
    select 1 from projects p, jsonb_array_elements(coalesce(p.data->'previews','[]'::jsonb)) e
    where p.id = pid and e->>'id' = vid and auth.uid()::text = any(p.members)
      and ( ((e->'to') ? auth.uid()::text and coalesce(e->>'show','true') <> 'false')
         or (not (e ? 'to') and p.client = auth.uid()::text and coalesce(e->>'show','true') <> 'false')
         or (public.review_inhouse() and (
              not exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v where v ? 'fid')
              or exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v join media_files mf on mf.id = v->>'fid' where public.media_fok(pid, mf.folder_id)))) ) ) $$;

-- Folder access can now list any person on the project (client, partners, crew too). A person who is listed on a folder's own list can open it.
create or replace function public.media_flisted(pid text, fid text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare cur text := fid; f record; n int := 0;
begin
  while cur is not null and n < 30 loop
    select * into f from media_folders where id = cur and project_id = pid;
    if not found then return false; end if;
    if coalesce(jsonb_array_length(f.access->'users'),0) > 0 then return (f.access->'users') ? auth.uid()::text; end if;
    cur := f.parent; n := n + 1;
  end loop;
  return false;
end $$;

create or replace function public.media_ok(pid text, fid text) returns boolean language sql stable security definer set search_path = public as $$
  select (public.review_inhouse() and (public.is_owner() or public.media_mgr(pid) or exists (select 1 from projects p where p.id = pid and auth.uid()::text = any(p.members)))
    and public.media_fok(pid, fid))
  or (fid is not null and exists (select 1 from projects p where p.id = pid and auth.uid()::text = any(p.members)) and public.media_flisted(pid, fid)) $$;

create or replace function public.review_ok(pid text, vid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.media_mgr(pid) or exists (
    select 1 from projects p, jsonb_array_elements(coalesce(p.data->'previews','[]'::jsonb)) e
    where p.id = pid and e->>'id' = vid and auth.uid()::text = any(p.members)
      and ( ((e->'to') ? auth.uid()::text and coalesce(e->>'show','true') <> 'false')
         or (not (e ? 'to') and p.client = auth.uid()::text and coalesce(e->>'show','true') <> 'false')
         or (public.review_inhouse() and (
              not exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v where v ? 'fid')
              or exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v join media_files mf on mf.id = v->>'fid' where public.media_fok(pid, mf.folder_id))))
         or exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v join media_files mf on mf.id = v->>'fid' where public.media_flisted(pid, mf.folder_id)) ) ) $$;

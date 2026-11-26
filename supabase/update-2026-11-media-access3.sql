-- a review is opened only by people ticked on it (or with folder access); no automatic client fallback
create or replace function public.review_ok(pid text, vid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.media_mgr(pid) or exists (
    select 1 from projects p, jsonb_array_elements(coalesce(p.data->'previews','[]'::jsonb)) e
    where p.id = pid and e->>'id' = vid and auth.uid()::text = any(p.members)
      and ( ((e->'to') ? auth.uid()::text and coalesce(e->>'show','true') <> 'false')
         or (public.review_inhouse() and (
              not exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v where v ? 'fid')
              or exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v join media_files mf on mf.id = v->>'fid' where public.media_fok(pid, mf.folder_id))))
         or exists (select 1 from jsonb_array_elements(coalesce(e->'vers','[]'::jsonb)) v join media_files mf on mf.id = v->>'fid' where public.media_flisted(pid, mf.folder_id)) ) ) $$;

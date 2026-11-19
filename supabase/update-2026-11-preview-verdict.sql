-- Preview approvals by the project's client and by credited directors / show producers with "Approve" access
create or replace function public.hub_preview_verdict(pid text, vid text, ok boolean, note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare d jsonb; i int; me text := auth.uid()::text;
begin
  if me is null then return false; end if;
  select data into d from projects where id = pid and me = any(members) for update;
  if d is null then return false; end if;
  if not (coalesce(d->>'client','') = me or exists (
      select 1 from jsonb_array_elements(coalesce(d->'director','[]'::jsonb) || coalesce(d->'showProducers','[]'::jsonb)) e
      where e->>'id' = me and e->>'access' = 'approve')) then return false; end if;
  for i in 0 .. coalesce(jsonb_array_length(d->'previews'), 0) - 1 loop
    if d->'previews'->i->>'id' = vid then
      d := jsonb_set(d, array['previews', i::text, 'verdicts'],
             coalesce(d->'previews'->i->'verdicts', '{}'::jsonb) || jsonb_build_object(me,
               jsonb_build_object('ok', ok, 'note', left(coalesce(note,''), 500), 'ts', (extract(epoch from now()) * 1000)::bigint)));
      update projects set data = d, updated_at = now() where id = pid;
      return true;
    end if;
  end loop;
  return false;
end $$;
revoke all on function public.hub_preview_verdict(text,text,boolean,text) from public, anon;
grant execute on function public.hub_preview_verdict(text,text,boolean,text) to authenticated;

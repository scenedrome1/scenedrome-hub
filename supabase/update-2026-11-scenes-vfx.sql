-- SCENEDROME Hub · update: scenes, versions, VFX shots, briefs & storage permissions
-- Run once in Supabase → SQL Editor. Safe to run again.

-- Who edits a project's storage data: owner, managers, the project's producer,
-- and its editing team (roles set per project: Main Editor, Sr Editor, 1st Asst. Editor, Asst Editor, DIT)
create or replace function public.edits_project(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.my_role() = 'manager' or exists (
    select 1 from projects p where p.id = pid and (
      p.producer = auth.uid()::text
      or coalesce(p.data->'roles'->>(auth.uid()::text), '') in ('main','sr','a1','asst','dit'))) $$;

drop policy if exists hub_insert on public.devices;
drop policy if exists hub_update on public.devices;
drop policy if exists hub_delete on public.devices;
create policy hub_insert on public.devices for insert with check (public.has_perm('storage.manage') or (project_id is not null and public.edits_project(project_id)));
create policy hub_update on public.devices for update using (public.has_perm('storage.manage') or (project_id is not null and public.edits_project(project_id)));
create policy hub_delete on public.devices for delete using (public.has_perm('storage.manage') or (project_id is not null and public.edits_project(project_id)));

-- Partner studios / vendors update the status + note of ONLY the VFX shots or sound items assigned to them.
-- They cannot change anything else in the project.
create or replace function public.hub_brief_status(pid text, ep int, kind text, item text, st text, note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare d jsonb; ei int; si int; hi int; me text := auth.uid()::text; found boolean := false;
begin
  if me is null or st not in ('todo','wip','review') then return false; end if;
  select data into d from projects where id = pid and me = any(members) for update;
  if d is null then return false; end if;
  for ei in 0 .. coalesce(jsonb_array_length(d->'episodes'), 0) - 1 loop
    continue when (d->'episodes'->ei->>'n')::int is distinct from ep;
    if kind = 'shot' then
      for si in 0 .. coalesce(jsonb_array_length(d->'episodes'->ei->'scenes'), 0) - 1 loop
        for hi in 0 .. coalesce(jsonb_array_length(d->'episodes'->ei->'scenes'->si->'shots'), 0) - 1 loop
          if d->'episodes'->ei->'scenes'->si->'shots'->hi->>'id' = item
             and d->'episodes'->ei->'scenes'->si->'shots'->hi->>'assignee' = me
             and coalesce(d->'episodes'->ei->'scenes'->si->'shots'->hi->>'status','') <> 'approved' then
            d := jsonb_set(d, array['episodes',ei::text,'scenes',si::text,'shots',hi::text,'status'], to_jsonb(st));
            d := jsonb_set(d, array['episodes',ei::text,'scenes',si::text,'shots',hi::text,'vnote'], to_jsonb(left(coalesce(note,''),500)));
            found := true;
          end if;
        end loop;
      end loop;
    elsif kind = 'sound' and d->'episodes'->ei->'sound'->>'assignee' = me then
      for hi in 0 .. coalesce(jsonb_array_length(d->'episodes'->ei->'sound'->'items'), 0) - 1 loop
        if d->'episodes'->ei->'sound'->'items'->hi->>'id' = item
           and coalesce(d->'episodes'->ei->'sound'->'items'->hi->>'status','') <> 'done' then
          d := jsonb_set(d, array['episodes',ei::text,'sound','items',hi::text,'status'], to_jsonb(st));
          d := jsonb_set(d, array['episodes',ei::text,'sound','items',hi::text,'vnote'], to_jsonb(left(coalesce(note,''),500)));
          found := true;
        end if;
      end loop;
    end if;
  end loop;
  if found then update projects set data = d, updated_at = now() where id = pid; end if;
  return found;
end $$;
revoke all on function public.hub_brief_status(text,int,text,text,text,text) from public, anon;
grant execute on function public.hub_brief_status(text,int,text,text,text,text) to authenticated;

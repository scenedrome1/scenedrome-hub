-- SCENEDROME Hub · update: client access per project + "Deal & money" on client profiles. Run once; safe to run again.

-- 1) what a client person may see on a project: their switches (main contact: all on unless turned off)
create or replace function public.client_perm(pid text, k text) returns boolean language sql stable security definer set search_path = public as $$
  select case when coalesce(public.my_role(), '') <> 'client' then true else coalesce((
    select coalesce(
      (select (e->'perms'->>k)::boolean from jsonb_array_elements(coalesce(p.data->'clientCrew', '[]'::jsonb)) e where e->>'id' = auth.uid()::text limit 1),
      case when p.client = auth.uid()::text then coalesce((p.data->'mainPerms'->>k)::boolean, true) end)
    from projects p where p.id = pid), false) end $$;

-- 2) money: a client sees a project's quotation and payments only with "Deal & money" ticked
--    (not set yet = on for the project's main contact, off for everyone else)
create or replace function public.fin_sees(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (select 1 from projects p join profiles me on me.id = auth.uid() and not me.suspended and me.role = 'client'
                 where p.id = pid
                   and (p.client = auth.uid()::text or coalesce(p.data->'clientCrew', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', auth.uid()::text)))
                   and coalesce((me.data->>'deal')::boolean, p.client = auth.uid()::text))
      or (public.is_staff() and public.has_perm('fin.member') and (
            public.has_perm('fin.allProjects') or public.has_perm('fin.p.' || pid)
            or exists (select 1 from projects p where p.id = pid and auth.uid()::text = any(p.members)))) $$;

-- 3) only the owner, managers and client managers can change someone's "Deal & money" — never the client themselves
create or replace function public.protect_deal() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_owner() or public.my_role() = 'manager' or public.has_perm('clients.manage') or public.has_perm('admin.users') then return new; end if;
  if old.data ? 'deal' then new.data := new.data || jsonb_build_object('deal', old.data->'deal'); else new.data := new.data - 'deal'; end if;
  return new;
end $$;
drop trigger if exists zz_protect_deal on public.profiles;
create trigger zz_protect_deal before update on public.profiles for each row execute function public.protect_deal();

-- 4) client thread and shared files follow the switches
drop policy if exists hub_select on public.messages;
create policy hub_select on public.messages for select using (public.can_see_project(project_id) and (
  (ch = 'team' and public.my_role() <> 'client')
  or (ch = 'client' and ((public.my_role() = 'client' and public.client_perm(project_id, 'thread')) or public.has_perm('proj.clientThread')))));
drop policy if exists hub_insert on public.messages;
create policy hub_insert on public.messages for insert with check (user_id = auth.uid()::text and public.can_see_project(project_id) and (
  (ch = 'team' and public.my_role() <> 'client')
  or (ch = 'client' and ((public.my_role() = 'client' and public.client_perm(project_id, 'thread')) or public.has_perm('proj.clientThread')))));
drop policy if exists hub_select on public.files;
create policy hub_select on public.files for select using (public.can_see_project(project_id)
  and (public.my_role() <> 'client' or ('client' = any(share) and public.client_perm(project_id, 'files'))));

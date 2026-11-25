-- SCENEDROME Hub: freelancers and clients see nothing they were not given.
-- Freelancers: only management and the people on projects they are on. Clients: only the team
-- members chosen for their project (update-2026-11-client-visibility.sql). Run once in the SQL editor.

-- in-house = staff who are not freelancers and not marked as outside
create or replace function public.is_inhouse() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role not in ('client','partner') and job <> 'freelancer'
                          and coalesce(data->>'inhouse','true') <> 'false'
                   from profiles where id = auth.uid() and not suspended), false) $$;

-- both people are on the same project
create or replace function public.shares_project_with(uid text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects p where auth.uid()::text = any(p.members) and uid = any(p.members)) $$;

-- people directory
drop policy if exists hub_select on public.profiles;
create policy hub_select on public.profiles for select using (
  id = auth.uid()
  or public.is_inhouse()
  or (public.is_staff() and role <> 'client' and (role in ('owner','manager') or public.shares_project_with(id::text)))
  or (public.my_role() = 'partner' and role not in ('client','partner') and (role in ('owner','manager') or public.shares_project_with(id::text)))
  or (role not in ('client','partner') and public.client_sees_staff(id::text))
);

-- only in-house staff edit other people's profiles
drop policy if exists hub_update on public.profiles;
create policy hub_update on public.profiles for update using (id = auth.uid() or public.is_inhouse());

-- studio equipment and rooms: in-house, or someone given the switch
drop policy if exists hub_select on public.devices;
create policy hub_select on public.devices for select using (public.is_inhouse() or public.has_perm('storage.view'));
drop policy if exists hub_select on public.rooms;
create policy hub_select on public.rooms for select using (public.is_inhouse() or public.has_perm('rooms.view') or public.has_perm('rooms.request') or public.has_perm('rooms.manage'));

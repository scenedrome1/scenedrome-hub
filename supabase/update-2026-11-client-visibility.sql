-- SCENEDROME Hub · update: clients see only the team members chosen for their project.
-- Run once in Supabase SQL Editor (owner). Safe to run again.
-- Team chat is already limited to project members by the existing messages rules.

-- 1) A team member is visible to a client only if that member is listed in the project's
--    "clientFacing" list (chosen by management) and the client is on that project.
create or replace function public.client_sees_staff(uid text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'client' and exists (
    select 1 from projects p
    where (p.client = auth.uid()::text
           or coalesce(p.data->'clientCrew', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', auth.uid()::text)))
      and coalesce(p.data->'clientFacing', '[]'::jsonb) ? uid
  ) $$;

-- 2) Profiles: staff are visible to staff, to themselves, and to clients only through rule 1.
drop policy if exists hub_select on public.profiles;
create policy hub_select on public.profiles for select using (
  id = auth.uid()
  or public.is_staff()
  or (role not in ('client','partner') and public.client_sees_staff(id))
);

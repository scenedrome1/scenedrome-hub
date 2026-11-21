-- Owner decides whether managers and producers may delete projects and messages.
-- The choice lives in settings('brand').data.delRoles = {"manager":true,"producer":false}
create or replace function public.del_role_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or coalesce((
    select (s.data->'delRoles'->>public.my_role())::boolean from public.settings s where s.id = 'brand'
  ), public.my_role() = 'manager')
$$;
drop policy if exists hub_delete on public.projects;
create policy hub_delete on public.projects for delete using (public.is_owner() or (public.del_role_ok() and public.can_see_project(id)));
drop policy if exists hub_delete on public.messages;
create policy hub_delete on public.messages for delete using (public.is_owner() or (public.del_role_ok() and public.can_see_project(project_id)));

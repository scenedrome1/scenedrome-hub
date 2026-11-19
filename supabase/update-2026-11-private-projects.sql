-- Private projects: only owners and the people added to the project see it (and its tasks, threads, files, money)
create or replace function public.can_see_project(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (select 1 from projects p where p.id = pid
         and (auth.uid()::text = any(p.members)
              or (public.has_perm('proj.all') and not coalesce((p.data->>'private')::boolean, false)))) $$;

create or replace function public.fin_sees(pid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or exists (select 1 from projects p where p.id = pid and p.client = auth.uid()::text)
      or (public.is_staff() and public.has_perm('fin.member') and (
            exists (select 1 from projects p where p.id = pid and auth.uid()::text = any(p.members))
            or ((public.has_perm('fin.allProjects') or public.has_perm('fin.p.' || pid))
                and not exists (select 1 from projects p where p.id = pid and coalesce((p.data->>'private')::boolean, false))))) $$;

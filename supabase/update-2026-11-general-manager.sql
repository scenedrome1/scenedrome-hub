-- General Manager consistency: repair the existing account and align quotation RLS with the Hub controls.
-- Run once in the Supabase SQL editor; safe to run again.

create or replace function public.is_general_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'manager' and (
      job = 'genmgr'
      or coalesce(data->'jobs', '[]'::jsonb) ? 'genmgr'
    )
    from profiles where id = auth.uid() and not suspended), false)
$$;

-- Older General Manager profiles could retain an artist/producer role and miss the
-- finance-list flags required by the newer privacy rules.
update public.profiles
set role = 'manager',
    access = coalesce(access, '{}'::jsonb) || jsonb_build_object(
      'proj.all', true,
      'proj.create', true,
      'proj.crew', true,
      'proj.tasks', true,
      'proj.breakdown', true,
      'proj.clientThread', true,
      'proj.previews', true,
      'fin.member', true,
      'fin.allProjects', true,
      'fin.projectEntry', true,
      'fin.budgetsAll', true,
      'fin.receivables', true
    )
where job = 'genmgr'
   or coalesce(data->'jobs', '[]'::jsonb) ? 'genmgr';

-- The Hub lets the General Manager edit, approve, return and remove quotation
-- items. The previous policies only allowed the original author or an owner,
-- which produced misleading, seemingly random "not allowed" notifications.
drop policy if exists hub_update on public.money_entries;
create policy hub_update on public.money_entries for update
using (
  public.is_owner()
  or (by_user = auth.uid()::text and status <> 'recorded')
  or (public.is_general_manager() and data->>'kind' = 'quote' and public.can_see_project(project_id))
)
with check (
  public.is_owner()
  or (by_user = auth.uid()::text and status <> 'recorded')
  or (public.is_general_manager() and data->>'kind' = 'quote' and public.can_see_project(project_id))
);

drop policy if exists hub_delete on public.money_entries;
create policy hub_delete on public.money_entries for delete
using (
  public.is_owner()
  or (by_user = auth.uid()::text and status <> 'recorded')
  or (public.is_general_manager() and data->>'kind' = 'quote' and public.can_see_project(project_id))
);

grant execute on function public.is_general_manager() to authenticated;

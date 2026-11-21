-- Studio group chat: in-house staff, plus freelancers the studio ticks "Internal group chat" for.
create or replace function public.in_group() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
    and p.role not in ('client','partner') and not p.suspended
    and ((coalesce((p.data->>'inhouse')::boolean, true) and p.job <> 'freelancer')
         or coalesce((p.data->>'groupChat')::boolean, false)
         or p.role in ('owner','manager')))
$$;
drop policy if exists hub_group_select on public.messages;
create policy hub_group_select on public.messages for select using (project_id = 'studio' and ch = 'group' and public.in_group());
drop policy if exists hub_group_insert on public.messages;
create policy hub_group_insert on public.messages for insert with check (user_id = auth.uid()::text and project_id = 'studio' and ch = 'group' and public.in_group());
drop policy if exists hub_group_update on public.messages;
create policy hub_group_update on public.messages for update using (project_id = 'studio' and ch = 'group' and public.in_group());

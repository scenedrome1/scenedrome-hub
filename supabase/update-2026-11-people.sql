-- SCENEDROME Hub · update: owners, user editing, people.add (run once in Supabase → SQL Editor; safe to run again)
create or replace function public.is_main_owner() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'owner' and job = 'founder') $$;

create or replace function public.protect_profile() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the studio account (main owner) can change anything
  if public.is_main_owner() then return new; end if;
  -- other owners: anything on non-owners, and their own details — never another owner, never their own role/access
  if public.is_owner() then
    if old.id = auth.uid() then
      new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended; new.email := old.email;
      return new;
    end if;
    if old.role = 'owner' then
      new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended; new.email := old.email;
      new.data := old.data || jsonb_strip_nulls(jsonb_build_object('kudos', new.data->'kudos'));
      return new;
    end if;
    if new.role = 'owner' then new.role := old.role; end if;
    new.email := old.email;
    return new;
  end if;
  new.email := old.email;
  -- nobody else touches owners (except sending kudos)
  if old.role = 'owner' then
    new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended;
    new.data := old.data || jsonb_strip_nulls(jsonb_build_object('kudos', new.data->'kudos'));
    return new;
  end if;
  if auth.uid() <> old.id and public.has_perm('admin.users') then
    if new.role = 'owner' then new.role := old.role; end if;
    return new;
  end if;
  new.role := old.role; new.job := old.job; new.access := old.access; new.suspended := old.suspended;
  if auth.uid() <> old.id then
    if public.has_perm('people.add') then
      new.data := old.data || (new.data - 'hist') || jsonb_build_object('hist', coalesce(new.data->'hist', old.data->'hist'));
      return new;
    end if;
    new.data := old.data
      || jsonb_strip_nulls(jsonb_build_object('kudos', new.data->'kudos'))
      || case when public.has_perm('team.leaves') then jsonb_strip_nulls(jsonb_build_object('leave', new.data->'leave')) else '{}'::jsonb end
      || case when public.has_perm('team.evaluate') then jsonb_strip_nulls(jsonb_build_object('perf', new.data->'perf', 'overtime', new.data->'overtime')) else '{}'::jsonb end
      || case when public.has_perm('team.studioInfo') then jsonb_strip_nulls(jsonb_build_object('title', new.data->'title', 'dept', new.data->'dept', 'joined', new.data->'joined', 'leave', new.data->'leave')) else '{}'::jsonb end;
  end if;
  return new;
end $$;

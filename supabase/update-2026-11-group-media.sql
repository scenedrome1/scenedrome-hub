-- SCENEDROME Chat media: files under group/ are readable and uploadable by chat members.
create or replace function public.can_see_object(obj text) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when split_part(obj, '/', 1) = 'dm' then position(auth.uid()::text in split_part(obj, '/', 2)) > 0
    when split_part(obj, '/', 1) = 'misc' then public.is_staff()
    when split_part(obj, '/', 1) = 'group' then public.in_group()
    else public.can_see_project(split_part(obj, '/', 1)) end $$;

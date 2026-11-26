-- SCENEDROME Hub · usernames (run once in Supabase → SQL Editor)
-- Each person has a unique username (stored in profiles.data.username). They can sign in with it instead of the email.

-- usernames are unique, ignoring capitals (blank ones are allowed)
create unique index if not exists profiles_username_uq
  on public.profiles (lower(data->>'username'))
  where coalesce(data->>'username', '') <> '';

-- sign-in helper: username → email (returns null if unknown or suspended)
create or replace function public.login_email(uname text)
returns text
language sql security definer set search_path = public stable
as $$
  select email from public.profiles
  where lower(data->>'username') = lower(trim(uname)) and not suspended
  limit 1
$$;

revoke all on function public.login_email(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;

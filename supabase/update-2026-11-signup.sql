-- Invite codes for sign-up. Only the Edge Functions (service role) read or write this table.
create table if not exists public.invites (
  code text primary key,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz
);
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;

-- Cash Flow double authentication: server-side password + single-use WhatsApp code.
-- These tables are intentionally inaccessible to browser clients. The cashflow-auth
-- Edge Function reaches them with the service-role key.

create table if not exists public.cashflow_auth_config (
  id text primary key check (id = 'primary'),
  password_salt text not null,
  password_hash text not null,
  password_iterations integer not null check (password_iterations >= 100000),
  password_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.cashflow_auth_config
  (id, password_salt, password_hash, password_iterations)
values
  ('primary', 'scenedrome-cashflow-lock-v1',
   '22c189842b3bcf93dfb3149cffbef8dda68b8691cb5f5386f7f380eeb14cfac7', 150000)
on conflict (id) do nothing;

create table if not exists public.cashflow_auth_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('login', 'reset')),
  delivery text not null default 'both' check (delivery = 'both'),
  code_hash text not null,
  attempts integer not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cashflow_auth_challenges_user_created_idx
  on public.cashflow_auth_challenges (user_id, created_at desc);

create table if not exists public.cashflow_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('cashflow', 'password_reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cashflow_auth_sessions_user_created_idx
  on public.cashflow_auth_sessions (user_id, created_at desc);

create table if not exists public.cashflow_auth_audit (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event text not null,
  success boolean not null default false,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cashflow_auth_audit_user_created_idx
  on public.cashflow_auth_audit (user_id, created_at desc);

alter table public.cashflow_auth_config enable row level security;
alter table public.cashflow_auth_challenges enable row level security;
alter table public.cashflow_auth_sessions enable row level security;
alter table public.cashflow_auth_audit enable row level security;

-- No RLS policies are created: anon/authenticated requests are denied by default.
revoke all on public.cashflow_auth_config from anon, authenticated;
revoke all on public.cashflow_auth_challenges from anon, authenticated;
revoke all on public.cashflow_auth_sessions from anon, authenticated;
revoke all on public.cashflow_auth_audit from anon, authenticated;
revoke all on sequence public.cashflow_auth_audit_id_seq from anon, authenticated;

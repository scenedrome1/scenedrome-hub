-- SCENEDROME Hub · update: Review player (our own Frame.io-style review) — time-coded comments, drawings, approval per version
-- Run once in Supabase → SQL Editor (safe to run again). Does not touch any existing data.

-- who may open a review: the owner, in-house staff on the project, and the people the preview was sent to (or the client when it was sent to nobody in particular)
create or replace function public.review_inhouse() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role not in ('client','partner')
                 and job <> 'freelancer' and coalesce(data->>'inhouse','') <> 'false') $$;

create or replace function public.review_ok(pid text, vid text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or exists (
    select 1 from projects p
    where p.id = pid and auth.uid()::text = any(p.members)
      and (public.review_inhouse() or exists (
        select 1 from jsonb_array_elements(coalesce(p.data->'previews','[]'::jsonb)) e
        where e->>'id' = vid and coalesce(e->>'show','true') <> 'false'
          and ( (e->'to') ? auth.uid()::text or (not (e ? 'to') and p.client = auth.uid()::text) ))) ) $$;

create table if not exists public.review_comments (
  id text primary key,
  project_id text not null references public.projects(id) on delete cascade,
  preview_id text not null,
  user_id text not null,
  data jsonb not null,
  created_at timestamptz default now());
create index if not exists review_comments_pv on public.review_comments (project_id, preview_id);
grant select, insert, update, delete on public.review_comments to authenticated;
alter table public.review_comments enable row level security;
drop policy if exists hub_select on public.review_comments;
drop policy if exists hub_insert on public.review_comments;
drop policy if exists hub_update on public.review_comments;
drop policy if exists hub_delete on public.review_comments;
create policy hub_select on public.review_comments for select using (public.review_ok(project_id, preview_id));
create policy hub_insert on public.review_comments for insert with check (public.review_ok(project_id, preview_id) and user_id = auth.uid()::text);
create policy hub_update on public.review_comments for update using (public.review_ok(project_id, preview_id) and (user_id = auth.uid()::text or public.is_owner() or public.review_inhouse()));
create policy hub_delete on public.review_comments for delete using (user_id = auth.uid()::text or public.is_owner());
do $$ begin alter publication supabase_realtime add table public.review_comments; exception when others then null; end $$;

-- approval / changes requested, per version (the client and credited approvers, like hub_preview_verdict)
create or replace function public.hub_review_verdict(pid text, vid text, ver text, ok boolean, note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare d jsonb; i int; vv jsonb; me text := auth.uid()::text;
begin
  if me is null or coalesce(ver,'') = '' then return false; end if;
  select data into d from projects where id = pid and me = any(members) for update;
  if d is null then return false; end if;
  if not (coalesce(d->>'client','') = me or exists (
      select 1 from jsonb_array_elements(coalesce(d->'director','[]'::jsonb) || coalesce(d->'showProducers','[]'::jsonb)) e
      where e->>'id' = me and e->>'access' = 'approve')) then return false; end if;
  for i in 0 .. coalesce(jsonb_array_length(d->'previews'), 0) - 1 loop
    if d->'previews'->i->>'id' = vid then
      vv := coalesce(d->'previews'->i->'vv', '{}'::jsonb);
      vv := jsonb_set(vv, array[ver], coalesce(vv->ver, '{}'::jsonb) || jsonb_build_object(me,
              jsonb_build_object('ok', ok, 'note', left(coalesce(note,''), 500), 'ts', (extract(epoch from now()) * 1000)::bigint)), true);
      d := jsonb_set(d, array['previews', i::text, 'vv'], vv, true);
      update projects set data = d, updated_at = now() where id = pid;
      return true;
    end if;
  end loop;
  return false;
end $$;
revoke all on function public.hub_review_verdict(text,text,text,boolean,text) from public, anon;
grant execute on function public.hub_review_verdict(text,text,text,boolean,text) to authenticated;

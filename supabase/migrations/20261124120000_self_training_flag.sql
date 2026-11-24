-- 1. Run in: Dev — project nnxrmaiinbmxfwzefbwx
--    SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
-- 2. After testing on the dev link, run in: Mumbai (prod) — project nptxjfvkqjuekgkspemu
--    SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
-- Check the project ref in the address bar before running.
--
-- Self-training flag per member (24 Nov 2026, Anand: "Membership only" as a third choice).
-- Until now every non-PT member of a gym with self_training_enabled was a self-training member. From this file
-- on a member is self-training only when the owner picks "Self-training" for them (Add / Edit member):
--   profiles.self_training = true  and  client_type <> 'pt'  and  the gym's self_training_enabled switch is on.
-- "Membership only" = not PT, self_training false. The app (lib/clientSettings.ts isSelfTraining) uses the same
-- rule and falls back to the old one while the column doesn't exist.
--
-- Additive only (CLAUDE.md Rule #1): one new column, one replaced function (same signature, one extra
-- condition), one new trigger. No DROP, DELETE or TRUNCATE.
--
-- Step 0 (read-only, run first): who would stop being self-training when Step 1 runs. Expected on Mumbai: no rows
-- (self-training was off for every gym on 19 Nov). Any rows here: run Step 2 in the same sitting.
--
--   select c.name, p.full_name, p.id
--   from public.profiles p join public.companies c on c.id = p.company_id
--   where p.role = 'client' and p.archived_at is null and coalesce(p.client_type, 'member') <> 'pt'
--     and (c.client_settings ->> 'self_training_enabled') = 'true'
--   order by c.name, p.full_name;
--
-- Step 0b (read-only): the live is_self_training_client() is still the 19 Nov version
-- (db/2026-11-19-client-view.md Step 1.4). Expect true; if false, stop and ask Claude to compare.
--
--   select pg_get_functiondef('public.is_self_training_client()'::regprocedure)
--          like '%client_settings ->> ''self_training_enabled''%';

-- ---------------------------------------------------------------------------------------------
-- Step 1
-- ---------------------------------------------------------------------------------------------
begin;

-- 1. The flag. false = membership only (or PT: client_type decides that)
alter table public.profiles add column if not exists self_training boolean not null default false;
comment on column public.profiles.self_training is
  'Self-training member (plans and logs their own workouts). Only counts when client_type <> pt and the gym has client_settings.self_training_enabled. Staff set it; clients and coaches cannot.';

-- 2. Is the caller a self-training member? The 19 Nov version plus "and p.self_training"
create or replace function public.is_self_training_client()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join companies c on c.id = p.company_id
     where p.id = auth.uid() and p.role = 'client' and p.archived_at is null
       and coalesce(p.client_type, 'member') <> 'pt'
       and p.self_training
       and (c.client_settings ->> 'self_training_enabled') = 'true'
  );
$$;
revoke all on function public.is_self_training_client() from public, anon;
grant execute on function public.is_self_training_client() to authenticated;

-- 3. Clients and coaches can't change the flag (a member can't make themselves self-training).
--    A separate trigger, so protect_profile_columns() is left exactly as it is.
create or replace function public.protect_self_training_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() in ('client', 'coach') and new.self_training is distinct from old.self_training then
    raise exception 'Not allowed to change the training type';
  end if;
  return new;
end $$;
revoke execute on function public.protect_self_training_flag() from public, anon, authenticated;

create trigger protect_self_training_flag
  before update on public.profiles
  for each row execute function public.protect_self_training_flag();

commit;

-- ---------------------------------------------------------------------------------------------
-- Step 2 (only if Step 0 listed anyone): keep today's self-training members self-training.
-- An update only. Marks every member from Step 0's list; to leave someone as membership only, add their id to skip.
-- ---------------------------------------------------------------------------------------------
-- begin;
-- with skip(id) as (select null::uuid)
-- update public.profiles p set self_training = true
-- from public.companies c
-- where c.id = p.company_id and p.role = 'client' and p.archived_at is null
--   and coalesce(p.client_type, 'member') <> 'pt'
--   and (c.client_settings ->> 'self_training_enabled') = 'true'
--   and p.id not in (select id from skip where id is not null)
-- returning c.name, p.full_name;
-- commit;

-- ---------------------------------------------------------------------------------------------
-- Step 3 — checks (read-only)
-- ---------------------------------------------------------------------------------------------
-- select column_name, data_type, column_default, is_nullable from information_schema.columns
--  where table_schema = 'public' and table_name = 'profiles' and column_name = 'self_training';
--  -- 1 row: boolean, false, NO
-- select pg_get_functiondef('public.is_self_training_client()'::regprocedure) like '%p.self_training%';  -- true
-- select tgname from pg_trigger where tgname = 'protect_self_training_flag';  -- 1 row
--
-- Step 4 — tests on dev (QA Gym, a new E2E member; each block rolls back). Fill in the ids.
-- begin;
-- set local role authenticated;
-- select set_config('request.jwt.claims', json_build_object('sub', '<CLIENT>', 'role', 'authenticated')::text, true);
-- update public.profiles set self_training = true where id = '<CLIENT>';   -- expect: error "Not allowed to change the training type"
-- rollback;
-- With <CLIENT> self_training = false (membership only) in a gym with self-training on:
--   insert into public.weekly_plans (client_id, week_start, plan_details) values ('<CLIENT>', current_date, 'x');  -- expect: RLS error
-- With self_training = true: the same insert returns 1 row.
--
-- Undo (only with Anand's approval): re-run db/2026-11-19-client-view.md Step 1.4 (the old function) and make
-- the trigger a no-op with create or replace … begin return new; end. The column stays (Rule #1).
--
-- Run log:
-- - Dev (nnxrmaiinbmxfwzefbwx): Step 1 run by Anand on 24 Nov 2026; Step 3 trigger check passed (protect_self_training_flag, 1 row).
-- - Mumbai (nptxjfvkqjuekgkspemu): not run yet.

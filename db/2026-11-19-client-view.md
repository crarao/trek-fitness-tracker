# Client app switches + self-training members (19 Nov 2026) — DRAFT, NOT RUN

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

**Status: reviewed 19 Nov (decisions in `docs/client-view-findings.md`). Not run yet: Step 1 goes with Part B,
Step 2 with Part C. Anand runs this; Claude does not.

Additive only (CLAUDE.md Rule #1): no `DROP`, `DELETE`, `TRUNCATE` or dropped columns.
- New columns, functions, triggers and **restrictive** policies.
- Three existing policies are changed with `alter policy`. Each keeps its old text and only adds a client branch.
  The old text is in `db/2026-10-30-rls-hardening.md` and `db/2026-11-05-exercise-logs.md`.

**Parts:**
- **Step 1** (Part B): settings, `client_setting()`, switch rules, `client_note`, the duplicate guard. Run before
  Part B ships.
- **Step 2** (Part C): `weekly_plans.created_by` and the self-training rules. Run before Part C ships.
- **Step 3**: checks.
- **Step 4**: tests (each rolls back).

**Defaults (decided by Anand 19 Nov):** the brief's defaults apply to a key that isn't stored. Gyms: client login
off, logging own sessions off. Individual coaches: client login off, logging sessions on. Everything else is on,
and self-training is off. `lib/clientSettings.ts` uses the same table. Running Step 1 therefore **turns the
client app off for every company** until Super Admin turns it on in the "Client app setup" card. That's fine:
FitLoft is in trial and nobody depends on it yet. Turning `client_login` back on lets that gym's clients straight
back in on their next visit; no password reset is needed. Run Step 0 first to see who would be affected.

## Step 0 — who uses the client app today (read-only, run first)

Companies whose clients logged their own sessions in the last 60 days (`logged_by` empty or themselves):

```sql
select c.name, c.company_type, count(distinct s.client_id) as clients, count(*) as sessions, max(s.session_date) as last
from public.logged_sessions s
join public.profiles p on p.id = s.client_id
join public.companies c on c.id = p.company_id
where (s.logged_by is null or s.logged_by = s.client_id)
  and s.session_date >= current_date - 60
group by c.name, c.company_type
order by sessions desc;
```

Any company listed here loses the client app when Step 1 runs. Turn `client_login` on for it in Super Admin
right after (once Part B is on the dev link / prod), or tell its clients first.

## Step 1 — client app switches (Part B)

```sql
begin;

-- 1. Per-gym client switches, set by Super Admin only. protect_company_columns is an allow-list
--    (logo / banner), so owners already can't change this column.
alter table public.companies add column if not exists client_settings jsonb not null default '{}'::jsonb;

-- 2. A note the client adds to a session their coach logged (B5 "Add a note")
alter table public.logged_sessions add column if not exists client_note text;

-- 3. The caller's gym switch. A missing or non-boolean value = the default for the gym's company type
--    (same table as lib/clientSettings.ts).
create or replace function public.client_setting(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    case c.client_settings ->> p_key when 'true' then true when 'false' then false end,
    case p_key
      when 'client_login' then false
      when 'self_training_enabled' then false
      when 'client_can_log_sessions' then coalesce(c.company_type, 'gym') = 'coach'
      else true
    end
  )
  from profiles p join companies c on c.id = p.company_id
  where p.id = auth.uid();
$$;
revoke all on function public.client_setting(text) from public, anon;
grant execute on function public.client_setting(text) to authenticated;

-- 4. Is the caller a self-training member? (Client, not PT, gym has self-training on.) Used in Step 2 too.
create or replace function public.is_self_training_client()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p join companies c on c.id = p.company_id
     where p.id = auth.uid() and p.role = 'client' and p.archived_at is null
       and coalesce(p.client_type, 'member') <> 'pt'
       and (c.client_settings ->> 'self_training_enabled') = 'true'
  );
$$;
revoke all on function public.is_self_training_client() from public, anon;
grant execute on function public.is_self_training_client() to authenticated;

-- 5. Restrictive switch rules. They only narrow what the client role may do; staff / coach / super admin pass.
--    A session with no plan_day is an activity (Log tab), with a plan_day it is a plan-day session.
--    Self-training members always log (Part C).
create policy "iso logged_sessions client switches" on public.logged_sessions
  as restrictive for insert to authenticated
  with check (
    (select public.get_my_role()) is distinct from 'client'
    or (select public.is_self_training_client())
    or ((select public.client_setting('client_login'))
        and case when plan_day is null then (select public.client_setting('client_can_log_activities'))
                 else (select public.client_setting('client_can_log_sessions')) end)
  );

create policy "iso weekly_plans client switches" on public.weekly_plans
  as restrictive for select to authenticated
  using (
    (select public.get_my_role()) is distinct from 'client'
    or (select public.is_self_training_client())
    or ((select public.client_setting('client_login')) and (select public.client_setting('client_sees_plan')))
  );

create policy "iso exercise_logs client switches" on public.exercise_logs
  as restrictive for select to authenticated
  using (
    (select public.get_my_role()) is distinct from 'client'
    or (select public.is_self_training_client())
    or ((select public.client_setting('client_login')) and (select public.client_setting('client_sees_detailed_progress')))
  );

-- Profile edits (fitness fields, goal). Reading your own profile stays open: the login page needs it
-- to show "Your gym hasn't turned on the client app yet."
create policy "iso profiles client switches" on public.profiles
  as restrictive for update to authenticated
  using (
    (select public.get_my_role()) is distinct from 'client'
    or ((select public.client_setting('client_login')) and (select public.client_setting('client_can_edit_profile')))
  );

-- 6. Clients may update their own sessions (alter policy: the old text + one client branch).
--    Which columns they may change is checked by the trigger in 7.
alter policy "iso logged_sessions update" on public.logged_sessions
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid()))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
        and (weekly_plan_id is null
             or exists (select 1 from public.weekly_plans w where w.id = logged_sessions.weekly_plan_id and w.client_id = logged_sessions.client_id)))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );

-- 7. What a client may change on a session:
--    - a session someone else logged (the coach), or any session if not self-training: only client_note
--    - their own session as a self-training member: everything except client_id / logged_by
create or replace function public.protect_session_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.get_my_role() is distinct from 'client' then return new; end if;
  if new.client_id is distinct from old.client_id or new.logged_by is distinct from old.logged_by then
    raise exception 'You can''t move a session or change who logged it';
  end if;
  if (old.logged_by is not null and old.logged_by <> auth.uid()) or not public.is_self_training_client() then
    if (to_jsonb(new) - 'client_note') is distinct from (to_jsonb(old) - 'client_note') then
      raise exception 'Your coach logged this session. You can add a note.';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.protect_session_columns() from public, anon, authenticated;

create trigger protect_session_columns
  before update on public.logged_sessions
  for each row execute function public.protect_session_columns();

-- 8. No duplicate of a plan day the coach already logged (B5). Coaches can still log / edit anything.
create or replace function public.no_client_duplicate_day()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.get_my_role() is distinct from 'client' then return new; end if;
  if new.plan_day is not null and new.weekly_plan_id is not null and exists (
    select 1 from logged_sessions s
     where s.client_id = new.client_id and s.weekly_plan_id = new.weekly_plan_id and s.plan_day = new.plan_day
       and s.logged_by is not null and s.logged_by <> new.client_id
  ) then
    raise exception 'Your coach has already logged this day. You can add a note to it.';
  end if;
  return new;
end $$;
revoke execute on function public.no_client_duplicate_day() from public, anon, authenticated;

create trigger no_client_duplicate_day
  before insert on public.logged_sessions
  for each row execute function public.no_client_duplicate_day();

-- 9a. Who logged a client's sessions / exercise rows, for "Logged by Coach Ravi" in the client app. Clients get
--     nothing from gym_staff(); this returns only the staff who appear as logged_by on the caller's OWN rows
--     (id, full name, role; no phone or email).
create or replace function public.my_loggers()
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role
  from profiles p
  where p.company_id = public.get_my_company_id()
    and p.role in ('company_admin', 'partner', 'coach')
    and p.id in (select s.logged_by from logged_sessions s where s.client_id = auth.uid()
                 union select l.logged_by from exercise_logs l where l.client_id = auth.uid());
$$;
revoke execute on function public.my_loggers() from public, anon;
grant execute on function public.my_loggers() to authenticated;

-- 9. Clients may only correct exercise rows they logged themselves (decision 4), not the coach's
alter policy "iso exercise_logs update" on public.exercise_logs
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
        and (logged_by is null or logged_by = (select auth.uid())))
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id()))
    or ((select public.get_my_role()) = 'coach' and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p where p.id = exercise_logs.client_id and p.client_type = 'pt'))
  )
  with check (
    exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
            where s.id = exercise_logs.session_id and s.client_id = exercise_logs.client_id
              and p.company_id = exercise_logs.company_id)
    and (exercise_id is null or exists (select 1 from public.exercises e where e.id = exercise_logs.exercise_id
            and (e.company_id is null or e.company_id = exercise_logs.company_id)))
    and (
      (select public.get_my_role()) = 'super_admin'
      or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
          and (logged_by is null or logged_by = (select auth.uid())))
      or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id()))
      or ((select public.get_my_role()) = 'coach' and company_id = (select public.get_my_company_id())
          and exists (select 1 from public.profiles p where p.id = exercise_logs.client_id and p.client_type = 'pt'))
    )
  );

commit;
```

Notes:
- The new restrictive rules sit next to `iso <table> active`, so the convention of four permissive rules per
  table is kept.
- A client-side write blocked by a restrictive **insert** check returns an RLS error. A blocked **update**
  returns 0 rows with no error, so the app must `.select()` after every client update and show an error
  on 0 rows (C3).
- With `client_sees_plan` off the client can't read their plans, so a plan-linked insert also fails
  (the insert rule looks the plan up). That's intended: no plan screen means no plan-day logging.

## Step 2 — self-training members (Part C)

```sql
begin;

-- 1. Who made the plan. Empty = staff or older plans; = client_id for a self-training member's own plan.
alter table public.weekly_plans add column if not exists created_by uuid references public.profiles(id);

-- Always the person saving (browser writes). Server routes (no auth.uid()) keep what they send.
create or replace function public.fill_plan_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid();
  else new.created_by := old.created_by; end if;
  return new;
end $$;
revoke execute on function public.fill_plan_created_by() from public, anon, authenticated;

create trigger fill_plan_created_by
  before insert or update on public.weekly_plans
  for each row execute function public.fill_plan_created_by();

-- 2. A self-training member adds and edits their OWN plans (never one the gym made). No delete.
alter policy "iso weekly_plans insert" on public.weekly_plans
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
        and (select public.is_self_training_client()))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );

alter policy "iso weekly_plans update" on public.weekly_plans
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
        and created_by = (select auth.uid()) and (select public.is_self_training_client()))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
        and (select public.is_self_training_client()))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );

-- 3. Weights per set from the client app: self-training members only (PT clients' weights are logged by
--    their coach). Restrictive, so it only narrows the existing iso exercise_logs insert rule.
create policy "iso exercise_logs self training" on public.exercise_logs
  as restrictive for insert to authenticated
  with check (
    (select public.get_my_role()) is distinct from 'client'
    or (select public.is_self_training_client())
  );

commit;
```

Notes:
- Select already lets a client read their own plans. `logged_sessions` insert already allows own
  sessions. `exercise_logs` insert / update already allow own rows (Step 1.9 limits updates to self-logged
  rows).
- **No delete for clients:** no client branch in any `iso … delete` rule, before or after.
- **Company scope:** a client's `client_id = auth.uid()`, and their profile's `company_id` can't change
  (`protect_profile_columns`). `exercise_logs` additionally checks `company_id` against the session's client.
- **AI plans:** `/api/generate-plan` stays staff / coach only (`PLAN_ROLES`). There is nothing to add for self-training.
- **Weekly repeat:** a member's plan is stored once and repeats every week in the app (`lib/self-training.ts`); an edit inserts a new row from that Monday. No extra column needed.

## Step 3 — checks (read-only)

```sql
select table_name, column_name, data_type from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'companies' and column_name = 'client_settings')
    or (table_name = 'logged_sessions' and column_name in ('client_note', 'logged_by'))
    or (table_name = 'weekly_plans' and column_name = 'created_by'))
order by 1, 2;
-- Expect 4 rows (3 after Step 1 only).

select tablename, policyname, cmd, permissive from pg_policies
where schemaname = 'public' and tablename in ('logged_sessions', 'weekly_plans', 'exercise_logs', 'profiles')
order by tablename, permissive desc, cmd, policyname;
-- Expect, per table, the four "iso <table> <action>" rules + the restrictive "… active" rule(s)
-- + one restrictive "iso <table> client switches".

select proname from pg_proc where proname in ('client_setting', 'is_self_training_client', 'my_loggers');
-- Expect 3 rows.

select tgname, tgrelid::regclass from pg_trigger
where tgname in ('protect_session_columns', 'no_client_duplicate_day', 'fill_plan_created_by');
```

## Step 4 — tests (each block rolls back; fill in the ids)

Use QA companies on **dev** only. For each block:
- `<CLIENT>` = a QA test client's `profiles.id`
- `<OTHER_CLIENT>` = a client of a **different** QA company
- `<COACH>` = a coach of the client's gym

Each block pretends to be that login:

```sql
-- Template (one per block)
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<CLIENT>', 'role', 'authenticated')::text, true);
-- … test …
rollback;
```

| # | Policy / trigger | Setup (inside the block, as super admin first, or set on the QA company beforehand) | Test as the client | Expect |
|---|---|---|---|---|
| T1 | `client switches` (sessions) | QA company `client_settings = '{"client_can_log_sessions": false}'` | `insert into logged_sessions (client_id, session_date, duration_minutes, plan_day) values ('<CLIENT>', current_date, 30, 'Monday')` | error: new row violates row-level security |
| T2 | same, activity | same settings | same insert with `plan_day` null | 1 row (activities still on) |
| T3 | `client switches` (plans) | `{"client_sees_plan": false}` | `select count(*) from weekly_plans` | 0 |
| T4 | `client switches` (exercise logs) | `{"client_sees_detailed_progress": false}` | `select count(*) from exercise_logs` | 0 |
| T5 | `client switches` (profiles) | `{"client_can_edit_profile": false}` | `update profiles set goal = goal where id = '<CLIENT>' returning id` | 0 rows |
| T6 | `client_login` | `{"client_login": false}` | T2's insert | error |
| T7 | `protect_session_columns` | a session for `<CLIENT>` with `logged_by = '<COACH>'` | `update logged_sessions set duration_minutes = 99 where id = '<ID>'` then `… set client_note = 'felt good'` | first: error "Your coach logged this session…"; second: 1 row |
| T8 | `no_client_duplicate_day` | same coach-logged session (plan + plan_day) | insert the same `weekly_plan_id` + `plan_day` as the client | error "Your coach has already logged this day…" |
| T9 | `iso exercise_logs update` | an `exercise_logs` row with `logged_by = '<COACH>'` | `update exercise_logs set reps = reps where id = '<ID>' returning id` | 0 rows |
| T10 | `iso weekly_plans insert` (self) | `{"self_training_enabled": true}`, `<CLIENT>` is `client_type = 'member'` | `insert into weekly_plans (client_id, week_start, plan_details) values ('<CLIENT>', current_date, 'test') returning created_by` | 1 row, `created_by = <CLIENT>` |
| T11 | same, PT client | `<CLIENT>` is `client_type = 'pt'` | T10's insert | error |
| T12 | same, other member | as `<CLIENT>` | insert with `client_id = '<OTHER_CLIENT>'` | error |
| T13 | `iso weekly_plans update` (self) | a plan for `<CLIENT>` made by staff | `update weekly_plans set plan_details = 'x' where id = '<ID>' returning id` | 0 rows (own plans only) |
| T14 | no client delete | — | `delete from weekly_plans where client_id = '<CLIENT>' returning id` (same for `logged_sessions`, `exercise_logs`) | 0 rows each |
| T16 | `my_loggers()` | a session for `<CLIENT>` logged by `<COACH>` | `select * from my_loggers()` | one row: the coach's id and name; another client of the gym gets 0 rows for it |
| T17 | `iso exercise_logs self training` | a PT client's own session | insert an `exercise_logs` row for it as that client | error; the same as a self-training member: 1 row |
| T15 | cross-company read | as `<CLIENT>` | `select count(*) from logged_sessions where client_id = '<OTHER_CLIENT>'` (also plans, exercise logs) | 0 |

Also re-run the cross-company script (kept outside the repo) after Step 1 and after Step 2.

## Undo (only with Anand's approval)

- **Columns** (`client_settings`, `client_note`, `created_by`) are left in place (Rule #1). The app ignores them if
  reverted.
- **Restrictive switch rules:** neutralise them without dropping:
  `alter policy "iso <table> client switches" on public.<table> using (true)`. For `logged_sessions`, use
  `with check (true)`, because it is an insert rule.
- **`alter policy` changes:** re-run the original text from `db/2026-10-30-rls-hardening.md` (`iso weekly_plans
  insert` / `update`, `iso logged_sessions update`) and `db/2026-11-05-exercise-logs.md` (`iso exercise_logs update`).
- **Triggers:** make them no-ops with `create or replace function … begin return new; end`. Dropping them needs
  Anand's explicit approval.

## Run log

- Dev: not run
- Mumbai: not run

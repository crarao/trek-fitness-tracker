# 30 Oct 2026 — Coach logins, primary coach, partner limit (ROADMAP #40) — IN PROGRESS

**Status (30 Oct, ~00:37 IST):** Step 0 checked and **Step 1b run** by Anand in Supabase (Mumbai project `coachboard-mumbai`).
Steps 1–5 still to run, before the coach app change.

Rules agreed 30 Oct:
- **Owner logins:** the owner (`company_admin`) plus partners (`partner`, same powers). Partners per company are capped by a new
  `companies.partner_limit`, **default 2**, which only super admin can change.
- **Coach logins:** new role `coach`, added by the owner or a partner, no limit. A coach sees **PT clients only**, all of them
  (not just their own), plus the gym's staff names. Coaches read, create and edit plans, read and log sessions, and read coach
  feedback for PT clients.
- **No access for coaches** to `memberships` (amounts), `leads`, `ai_usage`, or the `companies` settings. A coach sees each PT client's
  membership only as plan, start date and end date, through the function `pt_membership_status()`.
- **Primary coach:** `profiles.primary_coach_id` is a soft link. It never limits who can open or train a client. Only the owner, a partner
  or super admin can set it.
- **Deactivating a coach** uses the existing `archived_at` on their profile plus a login ban done by the server (app code). The
  trigger change in Step 4 stops a coach un-archiving themselves.

What it does (additive only; nothing existing is removed):

| Step | Change |
|---|---|
| 1b | Allow `role = 'coach'`: replace the `profiles_role_check` constraint (**approved by Anand 30 Oct, run**) |
| 1 | `companies.partner_limit` (default 2) and `profiles.primary_coach_id`, plus an index |
| 2 | New rules for the `coach` role on `profiles`, `weekly_plans`, `logged_sessions`, `session_feedback` (one rule per table and action) |
| 3 | Function `pt_membership_status()`: latest membership plan and dates (no amounts) for PT clients of the caller's gym |
| 4 | `protect_profile_columns` trigger also covers coaches and `primary_coach_id` (replaced in place, same name) |
| 5 | Check queries |

These new coach rules add to the "Multiple Permissive Policies" count from #50. Merging overlapping rules stays in #56.

---

## Step 0 — check (read-only)

```sql
-- A) Is profiles.role limited by a check constraint or an enum type? (blocks the new 'coach' value if so)
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.profiles'::regclass and contype = 'c';

select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name in ('role', 'client_type');

-- B) get_my_role() simply returns profiles.role (no hard-coded role list)
select pg_get_functiondef('public.get_my_role'::regproc);

-- C) memberships column types used by Step 3
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'memberships'
  and column_name in ('profile_id', 'company_id', 'plan_type', 'start_date', 'end_date', 'created_at')
order by column_name;
```

**Expected:**
- **A:** no constraint mentioning `role`. `role` is `text` (`udt_name = text`), not an enum.
- **B:** a body that selects `role` from `profiles` where `id = auth.uid()`.
- **C:** `plan_type` text, `start_date` and `end_date` date, `created_at` a timestamp.

**If A shows a role constraint or an enum, or C shows different types: stop and send a screenshot.** A role constraint would need replacing,
which counts as a removal and needs your explicit OK (CLAUDE.md Rule #1).

**Result 30 Oct:**
- **A:** `profiles_role_check` = `CHECK (role = ANY (ARRAY['super_admin','company_admin','client','partner']))`. It blocks `coach`, so Step 1b is needed. The other constraint, `profiles_meals_per_day_check`, is unrelated.
- **A2:** `role` and `client_type` are `text`.
- **B:** `get_my_role()` is `SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1;`. Fine as is.
- **C:** `plan_type` text, `start_date` / `end_date` date, `created_at` timestamptz. Step 3 is fine as written.

---

## Step 1b — allow the `coach` role · ✅ RUN 30 Oct

**Approved by Anand in the conversation on 30 Oct ("approved for 1b") and run by him the same night (Success).**
Postgres can't edit a check constraint in place, so the old rule is dropped and re-added with the same four roles plus `coach`,
in one transaction. No data touched; every existing row passes the new rule.

```sql
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['super_admin', 'company_admin', 'client', 'partner', 'coach']));
commit;
```

**Undo** (only while no coach logins exist; with Anand's approval):
```sql
begin;
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['super_admin', 'company_admin', 'client', 'partner']));
commit;
```

---

## Step 1 — new columns

```sql
begin;

-- Owner-level partner logins per company (super admin can raise it; the owner can't: protect_company_columns
-- only lets the owner change logo_url / banner_url)
alter table public.companies
  add column if not exists partner_limit smallint not null default 2
  check (partner_limit between 0 and 20);

-- Soft link from a PT client to their usual coach (null = unassigned). Never limits access.
alter table public.profiles
  add column if not exists primary_coach_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_company_primary_coach on public.profiles (company_id, primary_coach_id);

commit;
```

`logged_sessions (client_id, session_date)` already has an index (`logged_sessions_client_date`, #50).

---

## Step 2 — rules for the coach role

"PT client of my gym" = a `profiles` row with `role = 'client'`, `client_type = 'pt'` and the caller's `company_id`.

```sql
begin;

-- profiles: PT clients and staff of their own gym (staff names show as "by Coach X" / "Primary: Ravi").
-- Coaches already read their own row ("Users can read own profile"). No update rule for coaches on others.
create policy "Coaches read PT clients and staff" on public.profiles
  for select to authenticated
  using (
    (select public.get_my_role()) = 'coach'
    and company_id = (select public.get_my_company_id())
    and ((role = 'client' and client_type = 'pt')
         or role in ('company_admin', 'partner', 'coach'))
  );

-- weekly_plans: read, create, edit for PT clients (no delete)
create policy "Coaches read PT client plans" on public.weekly_plans
  for select to authenticated
  using (
    (select public.get_my_role()) = 'coach'
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  );

create policy "Coaches add PT client plans" on public.weekly_plans
  for insert to authenticated
  with check (
    (select public.get_my_role()) = 'coach'
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  );

create policy "Coaches update PT client plans" on public.weekly_plans
  for update to authenticated
  using (
    (select public.get_my_role()) = 'coach'
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  )
  with check (
    (select public.get_my_role()) = 'coach'
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  );

-- logged_sessions: read, log (stamped with their own login), correct (no delete)
create policy "Coaches read PT client sessions" on public.logged_sessions
  for select to authenticated
  using (
    (select public.get_my_role()) = 'coach'
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  );

create policy "Coaches log PT client sessions" on public.logged_sessions
  for insert to authenticated
  with check (
    (select public.get_my_role()) = 'coach'
    and logged_by = (select auth.uid())
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  );

create policy "Coaches update PT client sessions" on public.logged_sessions
  for update to authenticated
  using (
    (select public.get_my_role()) = 'coach'
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  )
  with check (
    (select public.get_my_role()) = 'coach'
    and client_id in (select id from public.profiles
                      where company_id = (select public.get_my_company_id())
                        and role = 'client' and client_type = 'pt')
  );

-- session_feedback: read only (history in the "Before you start" card and Sessions tab)
create policy "Coaches read PT client feedback" on public.session_feedback
  for select to authenticated
  using (
    (select public.get_my_role()) = 'coach'
    and session_id in (select ls.id from public.logged_sessions ls
                       join public.profiles p on p.id = ls.client_id
                       where p.company_id = (select public.get_my_company_id())
                         and p.role = 'client' and p.client_type = 'pt')
  );

commit;
```

`memberships`, `leads`, `ai_usage`, `contact_requests`: **no coach rules on purpose**, so coaches get nothing from them.
`companies`: coaches already read their own gym through "Users can read own company" and can't update it (owner-only rule).

---

## Step 3 — membership status for coaches, without amounts

```sql
begin;

create or replace function public.pt_membership_status()
returns table (profile_id uuid, plan_type text, start_date date, end_date date)
language sql stable security definer set search_path = public as $$
  select distinct on (m.profile_id) m.profile_id, m.plan_type, m.start_date, m.end_date
  from public.memberships m
  join public.profiles p on p.id = m.profile_id
  where public.get_my_role() in ('coach', 'company_admin', 'partner')
    and m.company_id = public.get_my_company_id()
    and p.company_id = public.get_my_company_id()
    and p.role = 'client' and p.client_type = 'pt'
  order by m.profile_id, m.start_date desc, m.created_at desc
$$;

revoke execute on function public.pt_membership_status() from public, anon;
grant execute on function public.pt_membership_status() to authenticated;

commit;
```

The app calls it with `supabase.rpc('pt_membership_status')` and works out Active / Expiring / Expired from `end_date`.
The latest membership is the newest `start_date`, with the newest row winning a tie: the same rule as the app (#28).

---

## Step 4 — trigger: coaches can't change protected columns on their own row

The existing "Clients can update own profile" rule (`id = auth.uid()`) also lets a coach edit their own profile. This replaces
the trigger function in place (same name, same trigger), so that clients **and coaches** can't change `client_type`,
`archived_at` (coach deactivation) or `primary_coach_id` on their own row. Staff and super admin are unchanged.

```sql
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() = 'super_admin' then return new; end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id then
    raise exception 'Not allowed to change role or company';
  end if;
  if public.get_my_role() in ('client', 'coach')
     and (new.client_type is distinct from old.client_type
          or new.archived_at is distinct from old.archived_at
          or new.primary_coach_id is distinct from old.primary_coach_id) then
    raise exception 'Not allowed to change membership type, archive status or primary coach';
  end if;
  return new;
end $$;
```

`create or replace` keeps the function's existing permissions (callers still can't run it directly; #50 Step 2).

**Undo for this step only** (puts back the 25 Oct version exactly):
```sql
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() = 'super_admin' then return new; end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id then
    raise exception 'Not allowed to change role or company';
  end if;
  if public.get_my_role() = 'client'
     and (new.client_type is distinct from old.client_type
          or new.archived_at is distinct from old.archived_at) then
    raise exception 'Not allowed to change membership type or archive status';
  end if;
  return new;
end $$;
```

---

## Step 5 — check

```sql
-- a) New columns
select table_name, column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'companies' and column_name = 'partner_limit')
    or (table_name = 'profiles'  and column_name = 'primary_coach_id'));          -- 2 rows, partner_limit default 2

-- b) Coach rules: expect 8
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and policyname like 'Coaches %'
order by tablename, cmd;

-- c) Function exists, security definer, not callable logged-out
select proname, prosecdef from pg_proc where proname = 'pt_membership_status';   -- true
select has_function_privilege('anon', 'public.pt_membership_status()', 'execute');           -- false
select has_function_privilege('authenticated', 'public.pt_membership_status()', 'execute');  -- true

-- d) Every company got partner_limit = 2
select partner_limit, count(*) from public.companies group by partner_limit;

-- e) The role rule now allows coach (Step 1b)
select pg_get_constraintdef(oid) from pg_constraint where conname = 'profiles_role_check';
```

Then rerun the Security Advisor. Expect no new warnings apart from the expected "signed-in users can execute SECURITY DEFINER function"
for `pt_membership_status` (same as `get_my_role` / `get_my_company_id`).

**Real test (after the app change ships):** with a coach login, `select * from memberships` from the app returns 0 rows;
`rpc('pt_membership_status')` returns plan and dates only, for PT clients of that gym only.

---

## Undo — only with Anand's explicit approval

No DROP statements are written here (CLAUDE.md Rule #1). In words, a full undo would remove:
- the 8 `Coaches …` rules
- the function `pt_membership_status()`
- the index `profiles_company_primary_coach`
- the columns `profiles.primary_coach_id` and `companies.partner_limit`, losing the primary coach assignments and any raised limits

Step 4 can be undone without removing anything, using the SQL shown under it. Step 1b's undo is shown under it.

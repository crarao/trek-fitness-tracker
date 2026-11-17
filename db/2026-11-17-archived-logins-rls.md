# Archived logins blocked in the database (17 Nov 2026)

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

## Why

PR #129 locks an archived client out of the app (`proxy.ts`, `getCaller`, the login page). But Supabase Auth still
accepts their password, so with a token taken straight from Supabase they could still read their own sessions,
memberships, plans… and the gym-wide tables, and log sessions. An archived (turned-off) coach is banned in Auth,
but a token they already hold stays valid for up to an hour.

After this file, the **database** refuses them too:

- **Archived** = `profiles.archived_at` set and role `client` or `coach` (the same rule as the app). Owners,
  partners and super admin are never affected.
- `get_my_role()` / `get_my_company_id()` return null for an archived login, so every gym-scoped rule and the RPCs
  that use them (`gym_staff`, `pt_membership_status`, `save_grading_results`, `undo_grading_results`) give them
  nothing.
- New `is_active_login()` + one **restrictive** rule per table (`iso <table> active`). A restrictive rule is ANDed
  with the existing `iso <table> <action>` rules, so it also covers the rules that check `auth.uid()` directly
  (own sessions, own memberships, own plans…). Nothing existing is changed or removed.
- **One exception:** an archived login may still **read its own `profiles` row** (read only). The login page reads
  it after sign-in to show "Your account is inactive. Please contact your gym." instead of "No profile found".
- **Restore** (`archived_at` back to null) gives everything back on the next request. No new login is needed.
- API routes and `proxy.ts` use the server key and are not affected.

Nothing is deleted or dropped. Safe to run twice.

## SQL (one go)

```sql
begin;

-- 1. Is the caller allowed to use the data? False only for an archived client / coach.
create or replace function public.is_active_login()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from profiles
    where id = auth.uid() and role in ('client', 'coach') and archived_at is not null
  );
$$;
revoke all on function public.is_active_login() from public, anon;
grant execute on function public.is_active_login() to authenticated;

-- 2. The helpers every rule uses: nothing for an archived client / coach (same as before for everyone else)
create or replace function public.get_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles
  where id = auth.uid() and not (role in ('client', 'coach') and archived_at is not null)
  limit 1;
$$;

create or replace function public.get_my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles
  where id = auth.uid() and not (role in ('client', 'coach') and archived_at is not null)
  limit 1;
$$;

-- 3. A restrictive rule on every public table with RLS on (profiles is done in step 4)
do $$
declare
  t text;
  pol text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and c.relname <> 'profiles'
    order by c.relname
  loop
    pol := 'iso ' || t || ' active';
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = pol) then
      execute format('alter policy %I on public.%I to authenticated using ((select public.is_active_login())) with check ((select public.is_active_login()))', pol, t);
    else
      execute format('create policy %I on public.%I as restrictive for all to authenticated using ((select public.is_active_login())) with check ((select public.is_active_login()))', pol, t);
    end if;
    raise notice 'active rule on %', t;
  end loop;
end $$;

-- 4. profiles: an archived login may read its own row (the login page's message), nothing else
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'iso profiles active select') then
    create policy "iso profiles active select" on public.profiles as restrictive for select to authenticated
      using ((select public.is_active_login()) or id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'iso profiles active insert') then
    create policy "iso profiles active insert" on public.profiles as restrictive for insert to authenticated
      with check ((select public.is_active_login()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'iso profiles active update') then
    create policy "iso profiles active update" on public.profiles as restrictive for update to authenticated
      using ((select public.is_active_login())) with check ((select public.is_active_login()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'iso profiles active delete') then
    create policy "iso profiles active delete" on public.profiles as restrictive for delete to authenticated
      using ((select public.is_active_login()));
  end if;
end $$;

commit;
```

## Check (read only)

Every RLS table should have its `active` rule(s); this lists any that don't (expect **no rows**):

```sql
select c.relname as table_without_active_rule
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
                  and p.policyname like 'iso % active%' and p.permissive = 'RESTRICTIVE');
```

As an archived test member, inside a transaction that is rolled back (replace the id with an **E2E** member that is
archived; never a real client):

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<archived E2E member id>","role":"authenticated"}', true);
select public.get_my_role(), public.get_my_company_id(), public.is_active_login();  -- null, null, false
select count(*) from public.companies;          -- 0
select count(*) from public.logged_sessions;    -- 0
select count(*) from public.memberships;        -- 0
select count(*) from public.exercises;          -- 0
select count(*) from public.profiles;           -- 1 (their own row only)
rollback;
```

Then on the dev link: an active member logs in and sees their home as before; owner, partner and coach screens are
unchanged. Regression R29 (`e2e-regression/login-guard.spec.ts`) checks the archived / restored token directly.

## New tables from now on

Every new table with RLS needs its `iso <table> active` restrictive rule too. Re-running step 3 adds it to any table
that is missing one (and changes nothing else).

## If it has to be undone

No drop needed: switch the rules off and put the helpers back as they were.

```sql
begin;
create or replace function public.get_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() limit 1;
$$;
create or replace function public.get_my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() limit 1;
$$;
do $$
declare r record;
begin
  for r in select tablename, policyname, cmd from pg_policies
           where schemaname = 'public' and policyname like 'iso % active%' and permissive = 'RESTRICTIVE'
  loop
    if r.cmd = 'SELECT' or r.cmd = 'DELETE' then
      execute format('alter policy %I on public.%I using (true)', r.policyname, r.tablename);
    elsif r.cmd = 'INSERT' then
      execute format('alter policy %I on public.%I with check (true)', r.policyname, r.tablename);
    else
      execute format('alter policy %I on public.%I using (true) with check (true)', r.policyname, r.tablename);
    end if;
  end loop;
end $$;
commit;
```

## Run log

- Dev (`nnxrmaiinbmxfwzefbwx`): run 17 Nov 2026. Archived E2E member check passed (role / company null, active false, 0 companies / sessions / memberships / exercises, 1 own profile row)
- Mumbai (`nptxjfvkqjuekgkspemu`): not yet

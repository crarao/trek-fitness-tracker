# 1 Nov 2026 — Exercise library (`exercises` table) — RUN WHEN AT A COMPUTER

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Order:** Step 1 (table + rules) → Step 2 (starter list, `supabase/seed_exercises.sql`) → Step 3 (checks).

Why: coaches build plans by picking exercises from a list instead of typing. The list is a shared
starter list (about 150 common exercises, `company_id` empty) plus each gym's own exercises, added
inline from the plan builder.

How it fits with plans (decided 1 Nov: extend `plan_json`, no new plan tables): plans stay in
`weekly_plans.plan_json`. Each exercise in a plan keeps its **name as a copy** (so renaming or
archiving an exercise never changes old plans) plus an optional `exercise_id` pointing here and an
optional `weight`. No change to `weekly_plans` or its rules, so client Done ✓ / ticks, today lists,
adherence and the progress share keep working as they are.

What it does (additive only, nothing existing is changed or removed):
- Creates one new table `public.exercises`.
- Unique name per gym (and once in the starter list), case-insensitive.
- RLS on with all four rules, `iso exercises <action>`:
  - **select:** every signed-in user reads the starter list and their own gym's exercises; super admin reads all.
  - **insert:** owner, partner and coach add exercises to **their own gym only**; super admin anything (the starter list is loaded from the SQL Editor).
  - **update:** owner, partner and coach edit their own gym's exercises (rename, archive) and can't move them to another gym or into the starter list; **starter list rows: super admin only**.
  - **delete:** nobody from the app (`using (false)`, and no delete permission). Exercises are archived (`is_archived`), never deleted (CLAUDE.md Rule #1).
- Logged-out visitors get nothing.

Foreign keys follow the app's own delete features (not something Claude runs): deleting a company in
super admin also removes its own exercises (`on delete cascade`); deleting a staff login keeps their
exercises and clears `created_by` (`on delete set null`).

## Step 1 — table and rules

```sql
begin;

-- 1. Table
create table if not exists public.exercises (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,  -- null = starter list
  name          text not null check (length(btrim(name)) between 1 and 120),
  aliases       text[] not null default '{}',      -- other names for search ("dand", "pec deck")
  muscle_group  text check (muscle_group in ('chest','back','legs','shoulders','arms','core','full_body','cardio','mobility')),
  equipment     text check (equipment in ('barbell','dumbbell','machine','cable','bodyweight','kettlebell','band','other')),
  is_archived   boolean not null default false,    -- hidden from the picker; old plans keep the name
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- 2. One name per gym, once in the starter list (case-insensitive)
create unique index if not exists exercises_company_name_key
  on public.exercises (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index if not exists exercises_company_idx on public.exercises (company_id);

-- 3. RLS: four rules
alter table public.exercises enable row level security;

create policy "iso exercises select" on public.exercises for select to authenticated
  using (
    company_id is null
    or company_id = (select public.get_my_company_id())
    or (select public.get_my_role()) = 'super_admin'
  );

create policy "iso exercises insert" on public.exercises for insert to authenticated
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and created_by is not distinct from (select auth.uid()))
  );

create policy "iso exercises update" on public.exercises for update to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id()))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id()))
  );

-- Nobody deletes exercises from the app: archive instead (Rule #1)
create policy "iso exercises delete" on public.exercises for delete to authenticated
  using (false);

-- 4. Explicit grants: signed-in users may read, add, update. No delete. Logged-out: nothing.
revoke all on public.exercises from anon, authenticated;
grant select, insert, update on public.exercises to authenticated;

commit;
```

## Step 2 — starter list

Open `supabase/seed_exercises.sql`, paste it into the same SQL Editor (Mumbai) and run it. It only
adds rows (`on conflict do nothing`), so running it twice is safe.

## Step 3 — checks

```sql
-- a) RLS on and four rules
select relrowsecurity from pg_class where oid = 'public.exercises'::regclass;   -- expect true
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'exercises' order by cmd;           -- expect 4 rows, {authenticated}

-- b) Grants: authenticated INSERT, SELECT, UPDATE only; anon nothing
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'exercises' and grantee in ('anon','authenticated')
order by grantee, privilege_type;

-- c) Starter list loaded (expect about 150) and spread across groups
select muscle_group, count(*) from public.exercises where company_id is null group by 1 order by 1;
```

### Cross-company test (rolls everything back)

Uses two real logins' ids: replace the four `<…>` values (Authentication → Users), then run the
whole block. Every `-- expect` line should match; nothing is kept (`rollback`). Deletes are covered by check b
(no delete permission), so the test doesn't try one.

```sql
begin;
-- Gym A coach adds an exercise
select set_config('request.jwt.claims', json_build_object('sub', '<gym A coach user id>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.exercises (company_id, name, muscle_group)
values ('<gym A company id>', 'Test Sled Push ZZ', 'legs');                               -- expect: works
select count(*) from public.exercises where name = 'Test Sled Push ZZ';                   -- expect 1
update public.exercises set name = 'Bench Press X' where company_id is null returning id;  -- expect 0 rows (starter list is read-only)
rollback;

begin;
-- Gym A coach adds it, then a coach from gym B looks
select set_config('request.jwt.claims', json_build_object('sub', '<gym A coach user id>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.exercises (company_id, name, muscle_group) values ('<gym A company id>', 'Test Sled Push ZZ', 'legs');
select set_config('request.jwt.claims', json_build_object('sub', '<gym B coach user id>', 'role', 'authenticated')::text, true);
select count(*) from public.exercises where name = 'Test Sled Push ZZ';                   -- expect 0
update public.exercises set is_archived = true where name = 'Test Sled Push ZZ' returning id; -- expect 0 rows
insert into public.exercises (company_id, name) values ('<gym A company id>', 'Sneaky ZZ'); -- expect: violates row-level security
rollback;
```

Repeat the first block with a gym A **owner** and a gym A **partner** login: same results.

## Undo

Only if ever needed, and only with Anand's explicit approval (Rule #1): the app works without the
table (the picker says the list isn't set up yet and typed exercises are still added to the plan).

Ran on prod (Mumbai): ✅ 3 Nov 2026 (by Anand)
Ran on dev: n/a (dev DB not set up yet)

# 3 Nov 2026 — Branches & batches (Dojo Build 2, ROADMAP #77) — ✅ RUN ON MUMBAI 3 NOV — do not run again

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Anand runs this; Claude does not.** Additions only: no `DROP`, no `DELETE`, no `TRUNCATE` (CLAUDE.md Rule #1).
The one `create or replace function` in Step 1 replaces `protect_profile_columns()` with its latest version
(`db/2026-11-01-multi-country.md` Step 1a item 5, matched live 2 Nov) plus two more columns; every existing check is kept.

## What it does

A dojo (DSKKA: Kokapet + a second branch) has branches, and classes ("batches") at each branch on set days and times.
A student joins with a **home batch** but can attend any batch (attendance is Build 3, #78).

- New table **`branches`**: a gym's locations (name, optional address). Archived, never deleted.
- New table **`batches`**: a class at one branch: name, days (`Mon`…`Sun`), start / end time. Archived, never deleted.
- **`profiles.branch_id`** and **`profiles.batch_id`** (nullable): a student's branch and home batch.
- The app shows all this to **martial arts** companies only for now. The tables work for any gym, so gym
  multi-branch (#20) can use them later without new SQL.

Who can do what (RLS, four rules per table, `iso <table> <action>`):
- **select:** everyone signed in to the gym (owner, partners, senseis / coaches, students) reads its branches and
  batches; super admin all. Senseis need them for Build 3 (today's batches).
- **insert / update:** owner and partners, their own gym only; a batch must belong to a branch of the same gym.
  Super admin anything.
- **delete:** nobody from the app (`using (false)`, no delete grant): archive instead (Rule #1).
- Logged-out visitors: nothing.

`protect_profile_columns`: clients and coaches can't change their own `branch_id` / `batch_id` (same as primary
coach). For everyone but super admin and the server, a saved branch / batch must belong to the profile's own gym,
and the batch must be at that branch.

Foreign keys follow the app's own delete features (not something Claude runs): deleting a company in super admin
removes its branches and batches (`on delete cascade`); a profile pointing at them is cleared (`on delete set null`).

## Step 1 — tables, rules, columns, trigger

```sql
begin;

-- 1. Branches
create table if not exists public.branches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  address      text check (address is null or length(address) <= 200),
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index if not exists branches_company_name_key on public.branches (company_id, lower(btrim(name)));
create index if not exists branches_company_idx on public.branches (company_id);

-- 2. Batches (a class at one branch)
create table if not exists public.batches (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  days         text[] not null default '{}'
               check (days <@ array['Mon','Tue','Wed','Thu','Fri','Sat','Sun']::text[]),
  start_time   time,
  end_time     time,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time)
);
create unique index if not exists batches_branch_name_key on public.batches (branch_id, lower(btrim(name)));
create index if not exists batches_company_idx on public.batches (company_id);

-- 3. A student's branch and home batch
alter table public.profiles add column if not exists branch_id uuid references public.branches(id) on delete set null;
alter table public.profiles add column if not exists batch_id  uuid references public.batches(id)  on delete set null;

-- 4. RLS: four rules per table
alter table public.branches enable row level security;
alter table public.batches  enable row level security;

create policy "iso branches select" on public.branches for select to authenticated
  using (company_id = (select public.get_my_company_id()) or (select public.get_my_role()) = 'super_admin');
create policy "iso branches insert" on public.branches for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
create policy "iso branches update" on public.branches for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
create policy "iso branches delete" on public.branches for delete to authenticated using (false);

create policy "iso batches select" on public.batches for select to authenticated
  using (company_id = (select public.get_my_company_id()) or (select public.get_my_role()) = 'super_admin');
create policy "iso batches insert" on public.batches for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.branches b where b.id = batches.branch_id and b.company_id = batches.company_id)));
create policy "iso batches update" on public.batches for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.branches b where b.id = batches.branch_id and b.company_id = batches.company_id)));
create policy "iso batches delete" on public.batches for delete to authenticated using (false);

-- 5. Explicit grants: read, add, update. No delete. Logged-out: nothing.
revoke all on public.branches from anon, authenticated;
revoke all on public.batches  from anon, authenticated;
grant select, insert, update on public.branches to authenticated;
grant select, insert, update on public.batches  to authenticated;

-- 6. protect_profile_columns: latest version (multi-country Step 1a item 5) with every check kept, plus
--    clients / coaches can't change branch_id / batch_id, and a branch / batch must be in the profile's own gym.
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
          or new.primary_coach_id is distinct from old.primary_coach_id
          or new.country is distinct from old.country
          or new.currency is distinct from old.currency
          or new.branch_id is distinct from old.branch_id
          or new.batch_id is distinct from old.batch_id) then
    raise exception 'Not allowed to change membership type, archive status, primary coach, country, currency, branch or batch';
  end if;
  if new.branch_id is distinct from old.branch_id and new.branch_id is not null
     and not exists (select 1 from public.branches b where b.id = new.branch_id and b.company_id = new.company_id) then
    raise exception 'Branch belongs to another gym';
  end if;
  if new.batch_id is distinct from old.batch_id and new.batch_id is not null
     and not exists (select 1 from public.batches t where t.id = new.batch_id and t.company_id = new.company_id
                     and (new.branch_id is null or t.branch_id = new.branch_id)) then
    raise exception 'Batch belongs to another gym or branch';
  end if;
  return new;
end $$;

commit;
```

`create or replace` keeps `protect_profile_columns`' existing permissions (callers still can't run it directly; #50 Step 2).

**Before running Step 1, check the live trigger is still the 2 Nov version** (Step 1 would otherwise overwrite something newer):

```sql
select pg_get_functiondef('public.protect_profile_columns()'::regprocedure);
```

Expect it to contain `new.country is distinct from old.country` and `primary_coach_id`, and **not** `branch_id`.
If it looks different, stop and send it to Claude.

## Step 2 — checks

**Run by Anand 3 Nov on Mumbai, all as expected:** (a) 8 rules, `iso branches|batches select/insert/update/delete`,
all `{authenticated}`; (b) grants: `authenticated` INSERT / SELECT / UPDATE on both tables, nothing for `anon`;
(c) `profiles.branch_id` and `batch_id` exist; (d) `protect_profile_columns()` contains `batch_id` → true.

```sql
-- a) RLS on and four rules on each table
select relname, relrowsecurity from pg_class where oid in ('public.branches'::regclass, 'public.batches'::regclass);  -- both true
select tablename, policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename in ('branches', 'batches') order by tablename, cmd;   -- 8 rows, {authenticated}

-- b) Grants: authenticated INSERT, SELECT, UPDATE only; anon nothing
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('branches', 'batches') and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- c) New profile columns
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name in ('branch_id', 'batch_id');   -- 2 rows

-- d) Trigger now knows branch / batch
select pg_get_functiondef('public.protect_profile_columns()'::regprocedure) like '%batch_id%';   -- true
```

## Before this runs

The app keeps working exactly as today. The dashboard asks for `batches` once; before the SQL that's an error, so the
"Branches & batches" link, the branch filter, the batch line on rows and the branch / batch pickers all stay hidden,
and saves never send `branch_id` / `batch_id`. Gyms never see any of it (martial arts only for now).

## Undo

No undo SQL is written here (CLAUDE.md Rule #1). An undo would remove the two tables and the two profile columns
and put back the 2 Nov `protect_profile_columns()`, **only with Anand's explicit approval**. Archiving branches and
batches in the app hides them without removing anything.

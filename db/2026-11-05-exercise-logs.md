Ran on prod (Mumbai): ⏳ not yet — Anand runs it
Ran on dev: n/a (dev DB not set up yet)

# 5 Nov 2026 — Weight / reps per exercise (`exercise_logs`, ROADMAP #80) — NOT RUN YET

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Anand runs this; Claude does not.** Additions only: one new table, no `DROP`, no `DELETE`, no `TRUNCATE`
(CLAUDE.md Rule #1). Needs `exercises` (`db/2026-11-01-exercise-library.md`, run 1 Nov).

**Order:** Step 1 (table + rules) → Step 2 (checks) → Step 3 (cross-company test, rolls back).

## What it does

Decided 5 Nov: when a coach marks a plan day done, each ticked exercise gets a pre-filled
"3 × 10 @ 12 kg" row. Those numbers are saved here, one row per exercise per session, so the next session
can start from the last numbers and the Progress tab can show top weight per month.

New table **`exercise_logs`**:
- `session_id` — the `logged_sessions` row it belongs to.
- `client_id`, `company_id` — copies of the session's client and gym, so the rules and "last time they did
  this exercise" are simple, fast queries. The rules check both copies match the session on every insert and
  update, so they can't point anywhere else.
- `exercise_id` — the library exercise when known (the app matches typed / AI names to the library on save);
  empty for names not in the library.
- `exercise_name` — a copy of the name, like plans keep (renaming an exercise never changes old logs).
  `name_key` = lower-case trimmed name, filled by Postgres, for grouping names without an id.
- `sets`, `reps`, `weight` (`null` = bodyweight / no weight), `unit` (`kg` only in the app for now; `lb` allowed
  for later), `set_details` (optional per-set list for pyramids, not used by the app yet).
- `logged_by` — who saved it (defaults to the person saving).
- No `updated_at` (decided 5 Nov).

Who can do what (RLS, four rules, `iso exercise_logs <action>`):
- **select:** a client reads their own; owner / partners read their gym's; coaches read their gym's
  **PT** clients'; super admin all.
- **insert:** the session must belong to `client_id`, that client must be a client of `company_id`, and the
  exercise (if any) must be the starter list or that gym's. Then: a client for their own sessions
  (`logged_by` empty or themselves); owner / partner for their gym (`logged_by` = themselves); coach for their
  gym's PT clients (`logged_by` = themselves); super admin anything.
- **update:** same people (client: own rows), and the same checks again, so a row can't be moved to another
  session, client or gym.
- **delete:** owner / partners of the gym and super admin only (same as `logged_sessions`). Clients and
  coaches can't delete. The app doesn't delete rows in v1.
- Logged-out visitors: nothing.

Foreign keys follow the app's own delete features (not something Claude runs): deleting a session, a client or
a company in the app removes their exercise logs (`on delete cascade`), so "Delete client" / "Delete company"
need no code change; deleting a staff login keeps the rows and clears `logged_by`; archiving a library exercise
changes nothing, and if one were ever removed the log keeps its name (`on delete set null`). **Delete cascade
order for a client is unchanged**: exercise logs go with the session automatically.

## Step 1 — table and rules

```sql
begin;

-- 1. Table
create table if not exists public.exercise_logs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.logged_sessions(id) on delete cascade,
  client_id     uuid not null references public.profiles(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  exercise_id   uuid references public.exercises(id) on delete set null,   -- null for names not in the library
  exercise_name text not null check (length(btrim(exercise_name)) between 1 and 120), -- copy, like plans
  name_key      text generated always as (lower(btrim(exercise_name))) stored,
  position      smallint not null default 0,
  sets          smallint check (sets between 1 and 20),
  reps          smallint check (reps between 1 and 200),
  weight        numeric(6,2) check (weight between 0 and 1000),            -- null = bodyweight / none
  unit          text not null default 'kg' check (unit in ('kg','lb')),
  set_details   jsonb,          -- optional [{reps, weight}] when sets differ (pyramids); not used yet
  logged_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

-- 2. Indexes: the session's rows, and "last time this client did this exercise"
create index if not exists exercise_logs_session_idx     on public.exercise_logs (session_id);
create index if not exists exercise_logs_client_ex_idx   on public.exercise_logs (client_id, exercise_id, created_at desc);
create index if not exists exercise_logs_client_name_idx on public.exercise_logs (client_id, name_key, created_at desc);
create index if not exists exercise_logs_company_idx     on public.exercise_logs (company_id);

-- 3. RLS: four rules
alter table public.exercise_logs enable row level security;

create policy "iso exercise_logs select" on public.exercise_logs for select to authenticated
  using (
    client_id = (select auth.uid())
    or (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id()))
    or ((select public.get_my_role()) = 'coach'
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p where p.id = exercise_logs.client_id
                    and p.role = 'client' and p.client_type = 'pt'))
  );

-- Every write: the session belongs to client_id, the client is in company_id,
-- and the exercise (if any) is the starter list or this gym's.
create policy "iso exercise_logs insert" on public.exercise_logs for insert to authenticated
  with check (
    exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
            where s.id = exercise_logs.session_id and s.client_id = exercise_logs.client_id
              and p.company_id = exercise_logs.company_id and p.role = 'client')
    and (exercise_id is null or exists (select 1 from public.exercises e where e.id = exercise_logs.exercise_id
            and (e.company_id is null or e.company_id = exercise_logs.company_id)))
    and (
      (select public.get_my_role()) = 'super_admin'
      or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
          and (logged_by is null or logged_by = (select auth.uid())))
      or ((select public.get_my_role()) in ('company_admin', 'partner') and logged_by = (select auth.uid())
          and company_id = (select public.get_my_company_id()))
      or ((select public.get_my_role()) = 'coach' and logged_by = (select auth.uid())
          and company_id = (select public.get_my_company_id())
          and exists (select 1 from public.profiles p where p.id = exercise_logs.client_id and p.client_type = 'pt'))
    )
  );

-- Correct a typo. The client edits their own; staff their gym's; coach their gym's PT clients'. Can't be moved.
create policy "iso exercise_logs update" on public.exercise_logs for update to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid()))
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
      or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid()))
      or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id()))
      or ((select public.get_my_role()) = 'coach' and company_id = (select public.get_my_company_id())
          and exists (select 1 from public.profiles p where p.id = exercise_logs.client_id and p.client_type = 'pt'))
    )
  );

-- Same as logged_sessions: only owner / partner (and super admin) remove a row
create policy "iso exercise_logs delete" on public.exercise_logs for delete to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id()))
  );

-- 4. Explicit grants: signed-in users only. Logged-out: nothing.
revoke all on public.exercise_logs from anon, authenticated;
grant select, insert, update, delete on public.exercise_logs to authenticated;

commit;
```

## Step 2 — checks (read-only)

```sql
-- a) RLS on
select relrowsecurity from pg_class where oid = 'public.exercise_logs'::regclass;        -- expect true

-- b) Four rules, all {authenticated}
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'exercise_logs' order by cmd;                -- expect 4 rows

-- c) Grants: authenticated DELETE, INSERT, SELECT, UPDATE; anon nothing
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'exercise_logs' and grantee in ('anon','authenticated')
order by grantee, privilege_type;

-- d) Foreign keys: session / client / company cascade, exercise / logged_by set null
select conname, confdeltype from pg_constraint
where conrelid = 'public.exercise_logs'::regclass and contype = 'f' order by conname;
-- expect: client_id, company_id, session_id → 'c'; exercise_id, logged_by → 'n'

-- e) Empty to start
select count(*) from public.exercise_logs;                                               -- expect 0
```

## Step 3 — cross-company test (rolls everything back)

These blocks are also meant to be copied into the cross-company test script (kept outside the public repo).
Nothing is kept: every block ends in `rollback`. A statement marked "expect: violates row-level security"
stops its block, so it is always the last statement before `rollback`.

**Gym A must be a gym, not a dojo** (it needs a regular member who isn't PT). Replace these `<…>` values
(Authentication → Users, and the `companies` table) before running:

| Placeholder | What |
|---|---|
| `<A company>` | gym A's `companies.id` |
| `<A owner>`, `<A partner>`, `<A coach>` | gym A logins (company_admin, partner, coach) |
| `<A pt client>` | a gym A client with `client_type = 'pt'` |
| `<A member>` | a gym A client who is **not** PT |
| `<B company>`, `<B owner>`, `<B coach>`, `<B client>` | gym B's id and logins |
| `<super admin>` | the super admin login |

Fixed test ids used below (rolled back, so they never clash): session `e1e1e1e1-0000-4000-8000-000000000001`,
log `e1e1e1e1-0000-4000-8000-0000000000a1`.

### Block 1 — owner logs; every role reads / edits / deletes

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A owner>');
insert into public.exercise_logs (id, session_id, client_id, company_id, exercise_id, exercise_name, sets, reps, weight)
values ('e1e1e1e1-0000-4000-8000-0000000000a1', 'e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>',
        (select id from public.exercises where company_id is null order by name limit 1), 'ZZ Squat', 3, 10, 12);  -- expect: works
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 1

-- Partner (gym A): reads, edits
select set_config('request.jwt.claims', json_build_object('sub', '<A partner>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 1
update public.exercise_logs set weight = 13 where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;        -- expect 1 row

-- Coach (gym A, PT client): reads, edits, can't delete
select set_config('request.jwt.claims', json_build_object('sub', '<A coach>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 1
update public.exercise_logs set weight = 14 where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;        -- expect 1 row
delete from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;                   -- expect 0 rows

-- The client themselves: reads, edits own, can't delete
select set_config('request.jwt.claims', json_build_object('sub', '<A pt client>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 1
update public.exercise_logs set reps = 11 where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;          -- expect 1 row
delete from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;                   -- expect 0 rows

-- Another client of the same gym: nothing
select set_config('request.jwt.claims', json_build_object('sub', '<A member>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 0
update public.exercise_logs set reps = 1 where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;           -- expect 0 rows

-- Gym B owner, coach, client: nothing
select set_config('request.jwt.claims', json_build_object('sub', '<B owner>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 0
update public.exercise_logs set weight = 99 where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;        -- expect 0 rows
delete from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;                   -- expect 0 rows
select set_config('request.jwt.claims', json_build_object('sub', '<B coach>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 0
update public.exercise_logs set weight = 99 where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;        -- expect 0 rows
select set_config('request.jwt.claims', json_build_object('sub', '<B client>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 0

-- Super admin: reads
select set_config('request.jwt.claims', json_build_object('sub', '<super admin>', 'role', 'authenticated')::text, true);
select count(*) from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';                       -- expect 1

-- Owner (gym A) can delete (the app doesn't in v1); rolled back anyway
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
delete from public.exercise_logs where id = 'e1e1e1e1-0000-4000-8000-0000000000a1' returning id;                   -- expect 1 row
rollback;
```

Repeat Block 1 with `<A partner>` in place of `<A owner>` in the first part (partner logs): same results.

### Block 2 — coach logs for a PT client (works)

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A coach>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A coach>');
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps, weight)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>', 'ZZ Squat', 3, 10, 12) returning logged_by; -- expect: works, logged_by = <A coach>
rollback;
```

### Block 3 — coach can't log for a non-PT member

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A member>', current_date, 45, 'ZZ test', '<A owner>');
select set_config('request.jwt.claims', json_build_object('sub', '<A coach>', 'role', 'authenticated')::text, true);
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A member>', '<A company>', 'ZZ Squat', 3, 10);  -- expect: violates row-level security
rollback;
```

### Block 4 — client logs their own (works)

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A pt client>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test');
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps, weight)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>', 'ZZ Squat', 3, 10, 12);  -- expect: works
rollback;
```

### Block 5 — client can't log in a coach's name

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A pt client>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test');
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>', 'ZZ Squat', 3, 10, '<A coach>');  -- expect: violates row-level security
rollback;
```

### Block 6 — client can't log on another client's session

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A owner>');
select set_config('request.jwt.claims', json_build_object('sub', '<A member>', 'role', 'authenticated')::text, true);
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A member>', '<A company>', 'ZZ Squat', 3, 10);  -- expect: violates row-level security
rollback;
```

### Block 7 — the copies must match the session (wrong gym)

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A owner>');
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<B company>', 'ZZ Squat', 3, 10);  -- expect: violates row-level security
rollback;
```

### Block 8 — the copies must match the session (wrong client)

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A owner>');
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A member>', '<A company>', 'ZZ Squat', 3, 10);  -- expect: violates row-level security
rollback;
```

### Block 9 — gym B owner can't log on gym A's session

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A owner>');
select set_config('request.jwt.claims', json_build_object('sub', '<B owner>', 'role', 'authenticated')::text, true);
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>', 'ZZ Squat', 3, 10);  -- expect: violates row-level security
rollback;
```

### Block 10 — gym B coach can't log on gym A's session

Same as Block 9 with `<B coach>` in place of `<B owner>`: expect violates row-level security.

### Block 11 — another gym's own exercise can't be used

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<B owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.exercises (id, company_id, name, muscle_group)
values ('e1e1e1e1-0000-4000-8000-0000000000b1', '<B company>', 'ZZ Gym B Only', 'legs');
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A owner>');
insert into public.exercise_logs (session_id, client_id, company_id, exercise_id, exercise_name, sets, reps)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>',
        'e1e1e1e1-0000-4000-8000-0000000000b1', 'ZZ Gym B Only', 3, 10);                 -- expect: violates row-level security
rollback;
```

### Block 12 — a row can't be moved to another gym by an update

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A owner>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A owner>');
insert into public.exercise_logs (id, session_id, client_id, company_id, exercise_name, sets, reps)
values ('e1e1e1e1-0000-4000-8000-0000000000a1', 'e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>', 'ZZ Squat', 3, 10);
update public.exercise_logs set company_id = '<B company>' where id = 'e1e1e1e1-0000-4000-8000-0000000000a1';  -- expect: violates row-level security
rollback;
```

### Block 13 — a coach can't log in someone else's name

```sql
begin;
select set_config('request.jwt.claims', json_build_object('sub', '<A coach>', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into public.logged_sessions (id, client_id, session_date, duration_minutes, notes, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', current_date, 45, 'ZZ test', '<A coach>');
insert into public.exercise_logs (session_id, client_id, company_id, exercise_name, sets, reps, logged_by)
values ('e1e1e1e1-0000-4000-8000-000000000001', '<A pt client>', '<A company>', 'ZZ Squat', 3, 10, '<A owner>');  -- expect: violates row-level security
rollback;
```

### Block 14 — logged out: nothing

```sql
begin;
set local role anon;
select count(*) from public.exercise_logs;                                               -- expect: permission denied
rollback;
```

## App behaviour before / after

Before the SQL runs, the app works as today: the weight rows don't appear (the page asks for `exercise_logs`
once; an error = not set up yet). After it runs, the coach sees "3 × 10 @ 12 kg" rows on ticked exercises when
marking a day done, the Sessions tab shows the numbers, and the Progress tab shows top weight per month.

## Undo

Only if ever needed, and only with Anand's explicit approval (Rule #1). No undo SQL is written here. The app
works without the table (the weight rows stay hidden).

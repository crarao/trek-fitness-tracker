Ran on prod (Mumbai): —
Ran on dev: n/a (dev DB not set up yet)

# 3 Nov 2026 — Attendance (Dojo Build 3, ROADMAP #78) — TO RUN BY ANAND

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Anand runs this; Claude does not.** Additions only: one new table, no `DROP`, no `DELETE`, no `TRUNCATE`
(CLAUDE.md Rule #1). Run after `db/2026-11-03-branches-batches.md` (run 3 Nov).

## What it does

Decided 3 Nov: a sensei (or the owner / a partner) opens a batch's class for a day and **taps who came**. Everyone
not tapped counts as absent. A student from another batch can be added as a **drop-in**. For dojos, attendance
replaces "Log session": the Progress tab and the parent's WhatsApp update count classes attended.

New table **`attendance`**, one row per student per batch per day:
- `present` — `true` when tapped; tapping again sets it to `false` (rows are never deleted).
- `is_drop_in` — the student's home batch is a different one.
- `marked_by` / `marked_at` — who tapped last, and when.
- One row per student, batch and day (`unique (batch_id, profile_id, class_date)`), so tapping twice can't double count.

Who can do what (RLS, four rules, `iso attendance <action>`):
- **select:** owner, partners and senseis / coaches read their gym's attendance; a student reads their own;
  super admin all.
- **insert / update:** owner, partners and senseis / coaches, **their own gym only**; the batch must be in that
  gym and the student must be a client of that gym (for a sensei: a PT client, which every dojo student is);
  `marked_by` must be the person saving. Super admin anything.
- **delete:** nobody from the app (`using (false)`, no delete grant). Untapping = `present = false`.
- Logged-out visitors: nothing.

Foreign keys follow the app's own delete features (not something Claude runs): deleting a company or a student
in the app removes their attendance (`on delete cascade`); deleting a staff login keeps the rows and clears
`marked_by` (`on delete set null`). **Delete cascade order for a client is unchanged**: attendance goes with the
profile automatically.

## Step 1 — table and rules

```sql
begin;

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  batch_id    uuid not null references public.batches(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  class_date  date not null,
  present     boolean not null default true,
  is_drop_in  boolean not null default false,
  marked_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  marked_at   timestamptz not null default now(),
  unique (batch_id, profile_id, class_date)
);
create index if not exists attendance_company_date_idx on public.attendance (company_id, class_date);
create index if not exists attendance_profile_idx on public.attendance (profile_id, class_date);

alter table public.attendance enable row level security;

create policy "iso attendance select" on public.attendance for select to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or profile_id = (select auth.uid())
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id()))
  );

create policy "iso attendance insert" on public.attendance for insert to authenticated
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and marked_by is not distinct from (select auth.uid())
        and exists (select 1 from public.batches b where b.id = attendance.batch_id and b.company_id = attendance.company_id)
        and exists (select 1 from public.profiles p where p.id = attendance.profile_id and p.company_id = attendance.company_id
                    and p.role = 'client'
                    and ((select public.get_my_role()) <> 'coach' or p.client_type = 'pt')))
  );

create policy "iso attendance update" on public.attendance for update to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id()))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and marked_by is not distinct from (select auth.uid())
        and exists (select 1 from public.batches b where b.id = attendance.batch_id and b.company_id = attendance.company_id)
        and exists (select 1 from public.profiles p where p.id = attendance.profile_id and p.company_id = attendance.company_id
                    and p.role = 'client'
                    and ((select public.get_my_role()) <> 'coach' or p.client_type = 'pt')))
  );

-- Nobody deletes attendance from the app: untap = present false (Rule #1)
create policy "iso attendance delete" on public.attendance for delete to authenticated using (false);

revoke all on public.attendance from anon, authenticated;
grant select, insert, update on public.attendance to authenticated;

commit;
```

## Step 2 — checks

```sql
-- a) RLS on, four rules
select relrowsecurity from pg_class where oid = 'public.attendance'::regclass;            -- true
select policyname, cmd, roles from pg_policies
where schemaname = 'public' and tablename = 'attendance' order by cmd;                   -- 4 rows, {authenticated}

-- b) Grants: authenticated INSERT, SELECT, UPDATE only; anon nothing
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'attendance' and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;
```

## Before this runs

The app keeps working exactly as today (Build 1.2 / 2): dojo pages ask for `attendance` once; before the SQL that's
an error, so senseis keep "Log session" and the "Came today" list, and Progress keeps counting sessions.

## Undo

No undo SQL is written here (CLAUDE.md Rule #1). An undo would remove the `attendance` table, **only with Anand's
explicit approval**.

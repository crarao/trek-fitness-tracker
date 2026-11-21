# 19 Nov 2026 — Dojo class activities, leave, holidays, absence messages, 7-day lock — ✅ RUN ON DEV 19 NOV AND MUMBAI 21 NOV — do not run again

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

**Anand runs this; Claude does not.** Additions only (CLAUDE.md Rule #1): new tables, functions and triggers. No
`DROP`, `DELETE`, `TRUNCATE` or dropped columns. Nothing existing is changed except one new trigger on `attendance`
(the 7-day lock). Needs `branches` / `batches` and `attendance` (run 3 Nov) and `is_active_login()` (17 Nov).

**Order:** Step 1 (tables, rules, lock) → Step 2 (the dojo's 13 activities) → Step 3 (checks).

## What it does

Spec: "Dojo Daily Activity & Attendance — Spec" (decided 17–19 Nov).

New tables (each: RLS on, four `iso <table> <action>` rules, the restrictive `iso <table> active` rule, grants to
`authenticated` only, no delete):

| Table | What it holds | Who writes |
|---|---|---|
| `dojo_activities` | The dojo's activity list (warm-ups, kata, kumite…). Archived, never deleted. | owner, partner |
| `batch_classes` | One row = one batch's class on one day: logged by / when, owner unlock. | owner, partner, sensei; unlock: owner only |
| `batch_class_activities` | Activities done in that class (name copied). Untick = `removed_at`. | owner, partner, sensei |
| `student_leaves` | A student on leave from / to a date. Cancel = `cancelled_at`. | owner, partner, sensei |
| `holidays` | Dojo calendar, per branch (`branch_id` empty = all branches). Remove = `removed_at`. | owner, partner |
| `message_templates` | The absence WhatsApp text (one per gym, kind `absence`). | owner, partner |

Reads: owner, partners and senseis read their gym's rows (message templates: owner and partners only). Students
read nothing here (dojo students don't log in). Super admin: everything.

**7-day lock** (`dojo_today()` = today in India; `class_day_locked(batch, date)`): a class day more than 7 days
back can't be changed (attendance, the class row, its activities) unless the owner has unlocked it
(`batch_classes.unlocked_at`). Only the owner (`company_admin`) sets or clears an unlock; super admin and the server
are never blocked. This also applies to the existing roll call (agreed 19 Nov: no dojo uses attendance live yet).

Foreign keys follow the app's own delete features (not something Claude runs): deleting a company, batch, branch
or student in the app removes their rows here (`on delete cascade`); deleting a staff login keeps the rows and
clears who did it (`on delete set null`).

## Step 1 — tables, rules, lock

```sql
begin;

-- 0. Helpers: today in India, and "is this batch-day locked?"
create or replace function public.dojo_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- 1. Activity list
create table if not exists public.dojo_activities (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 60),
  description  text check (description is null or length(description) <= 200),
  sort_order   integer not null default 0,
  is_default   boolean not null default false,   -- pre-ticked on every new class (the two warm-ups)
  is_archived  boolean not null default false,   -- hidden from the picker; history keeps the name
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists dojo_activities_company_name_key on public.dojo_activities (company_id, lower(btrim(name)));
create index if not exists dojo_activities_company_idx on public.dojo_activities (company_id);

-- 2. One batch's class on one day
create table if not exists public.batch_classes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  batch_id     uuid not null references public.batches(id) on delete cascade,
  class_date   date not null,
  logged_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  logged_at    timestamptz,                       -- null = not logged yet (e.g. a row made only to unlock the day)
  unlocked_by  uuid references public.profiles(id) on delete set null,
  unlocked_at  timestamptz,                       -- set = owner unlocked this day past the 7-day lock
  notes        text check (notes is null or length(notes) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (batch_id, class_date)
);
create index if not exists batch_classes_company_date_idx on public.batch_classes (company_id, class_date);

create or replace function public.class_day_locked(p_batch uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_date < public.dojo_today() - 7
     and not exists (select 1 from batch_classes c
                     where c.batch_id = p_batch and c.class_date = p_date and c.unlocked_at is not null);
$$;
revoke all on function public.class_day_locked(uuid, date) from public, anon;
grant execute on function public.class_day_locked(uuid, date) to authenticated;

-- 3. Activities done in a class
create table if not exists public.batch_class_activities (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  class_id       uuid not null references public.batch_classes(id) on delete cascade,
  activity_id    uuid not null references public.dojo_activities(id) on delete cascade,
  activity_name  text not null check (length(btrim(activity_name)) between 1 and 60),  -- copy, history keeps it
  removed_at     timestamptz,                     -- untick = removed, never erased; tick again = null
  created_at     timestamptz not null default now(),
  unique (class_id, activity_id)
);
create index if not exists batch_class_activities_company_idx on public.batch_class_activities (company_id);

-- 4. Leave
create table if not exists public.student_leaves (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  from_date     date not null,
  to_date       date not null,
  note          text check (note is null or length(note) <= 200),
  marked_by     uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references public.profiles(id) on delete set null,
  check (to_date >= from_date)
);
create index if not exists student_leaves_profile_idx on public.student_leaves (profile_id, from_date, to_date);
create index if not exists student_leaves_company_idx on public.student_leaves (company_id, from_date);

-- 5. Holidays (per branch; branch_id null = all branches)
create table if not exists public.holidays (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  branch_id     uuid references public.branches(id) on delete cascade,
  holiday_date  date not null,
  name          text not null check (length(btrim(name)) between 1 and 60),
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  removed_at    timestamptz,                      -- removed = no longer a holiday, kept for history
  removed_by    uuid references public.profiles(id) on delete set null
);
create unique index if not exists holidays_one_per_day_key
  on public.holidays (company_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), holiday_date)
  where removed_at is null;
create index if not exists holidays_company_date_idx on public.holidays (company_id, holiday_date);

-- 6. Message templates (absence WhatsApp; one per gym per kind)
create table if not exists public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        text not null check (kind in ('absence')),
  body        text not null check (length(btrim(body)) between 1 and 1000),
  updated_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (company_id, kind)
);

-- 7. Triggers: the 7-day lock, owner-only unlock, updated_at
create or replace function public.attendance_lock_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.get_my_role() = 'super_admin' then return new; end if;
  if public.class_day_locked(new.batch_id, new.class_date) then
    raise exception 'Attendance for % is locked (older than 7 days). Ask the owner to unlock it.', new.class_date;
  end if;
  if tg_op = 'UPDATE' and (old.batch_id is distinct from new.batch_id or old.class_date is distinct from new.class_date)
     and public.class_day_locked(old.batch_id, old.class_date) then
    raise exception 'Attendance for % is locked (older than 7 days). Ask the owner to unlock it.', old.class_date;
  end if;
  return new;
end $$;
create or replace trigger attendance_lock_check before insert or update on public.attendance
  for each row execute function public.attendance_lock_check();

create or replace function public.batch_class_checks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_owner boolean;
begin
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if auth.uid() is null or public.get_my_role() = 'super_admin' then return new; end if;
  is_owner := public.get_my_role() = 'company_admin';

  if tg_op = 'INSERT' then
    if new.unlocked_at is not null or new.unlocked_by is not null then
      if not is_owner then raise exception 'Only the owner can unlock a class day'; end if;
      new.unlocked_by := auth.uid();
      return new;
    end if;
    if new.class_date < public.dojo_today() - 7 then
      raise exception 'Class on % is locked (older than 7 days). Ask the owner to unlock it.', new.class_date;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.batch_id is distinct from old.batch_id or new.class_date is distinct from old.class_date
     or new.company_id is distinct from old.company_id then
    raise exception 'A class can''t be moved to another batch or day';
  end if;
  if new.unlocked_at is distinct from old.unlocked_at or new.unlocked_by is distinct from old.unlocked_by then
    if not is_owner then raise exception 'Only the owner can unlock or lock a class day'; end if;
    new.unlocked_by := case when new.unlocked_at is null then null else auth.uid() end;
  end if;
  if new.logged_by is distinct from old.logged_by and new.logged_by is distinct from auth.uid() then
    raise exception 'logged_by must be the person saving';
  end if;
  if (new.logged_at is distinct from old.logged_at or new.logged_by is distinct from old.logged_by
      or new.notes is distinct from old.notes)
     and new.class_date < public.dojo_today() - 7 and new.unlocked_at is null then
    raise exception 'Class on % is locked (older than 7 days). Ask the owner to unlock it.', new.class_date;
  end if;
  return new;
end $$;
create or replace trigger batch_class_checks before insert or update on public.batch_classes
  for each row execute function public.batch_class_checks();

create or replace function public.batch_class_activity_checks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record;
begin
  if tg_op = 'UPDATE' and (new.class_id is distinct from old.class_id or new.activity_id is distinct from old.activity_id
                           or new.company_id is distinct from old.company_id) then
    raise exception 'A class activity can''t be moved; untick it instead';
  end if;
  if auth.uid() is null or public.get_my_role() = 'super_admin' then return new; end if;
  select batch_id, class_date into c from batch_classes where id = new.class_id;
  if public.class_day_locked(c.batch_id, c.class_date) then
    raise exception 'Class on % is locked (older than 7 days). Ask the owner to unlock it.', c.class_date;
  end if;
  return new;
end $$;
create or replace trigger batch_class_activity_checks before insert or update on public.batch_class_activities
  for each row execute function public.batch_class_activity_checks();

create or replace function public.message_template_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace trigger message_template_touch before update on public.message_templates
  for each row execute function public.message_template_touch();

-- 8. RLS: four rules per table + the restrictive active rule
alter table public.dojo_activities        enable row level security;
alter table public.batch_classes          enable row level security;
alter table public.batch_class_activities enable row level security;
alter table public.student_leaves         enable row level security;
alter table public.holidays               enable row level security;
alter table public.message_templates      enable row level security;

-- dojo_activities: staff + senseis read; owner / partner write
create policy "iso dojo_activities select" on public.dojo_activities for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())));
create policy "iso dojo_activities insert" on public.dojo_activities for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and created_by is not distinct from (select auth.uid())));
create policy "iso dojo_activities update" on public.dojo_activities for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
create policy "iso dojo_activities delete" on public.dojo_activities for delete to authenticated using (false);

-- batch_classes: staff + senseis read and write their gym's (the batch must be in the gym)
create policy "iso batch_classes select" on public.batch_classes for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())));
create policy "iso batch_classes insert" on public.batch_classes for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and logged_by is not distinct from (select auth.uid())
        and exists (select 1 from public.batches b where b.id = batch_classes.batch_id and b.company_id = batch_classes.company_id)));
create policy "iso batch_classes update" on public.batch_classes for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.batches b where b.id = batch_classes.batch_id and b.company_id = batch_classes.company_id)));
create policy "iso batch_classes delete" on public.batch_classes for delete to authenticated using (false);

-- batch_class_activities: the class and the activity must both be in the gym
create policy "iso batch_class_activities select" on public.batch_class_activities for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())));
create policy "iso batch_class_activities insert" on public.batch_class_activities for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.batch_classes c where c.id = batch_class_activities.class_id and c.company_id = batch_class_activities.company_id)
        and exists (select 1 from public.dojo_activities a where a.id = batch_class_activities.activity_id and a.company_id = batch_class_activities.company_id)));
create policy "iso batch_class_activities update" on public.batch_class_activities for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.batch_classes c where c.id = batch_class_activities.class_id and c.company_id = batch_class_activities.company_id)
        and exists (select 1 from public.dojo_activities a where a.id = batch_class_activities.activity_id and a.company_id = batch_class_activities.company_id)));
create policy "iso batch_class_activities delete" on public.batch_class_activities for delete to authenticated using (false);

-- student_leaves: staff + senseis; the student must be a client of the gym (a sensei: a PT client, every dojo student)
create policy "iso student_leaves select" on public.student_leaves for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())));
create policy "iso student_leaves insert" on public.student_leaves for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and marked_by is not distinct from (select auth.uid())
        and exists (select 1 from public.profiles p where p.id = student_leaves.profile_id and p.company_id = student_leaves.company_id
                    and p.role = 'client'
                    and ((select public.get_my_role()) <> 'coach' or p.client_type = 'pt'))));
create policy "iso student_leaves update" on public.student_leaves for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p where p.id = student_leaves.profile_id and p.company_id = student_leaves.company_id
                    and p.role = 'client'
                    and ((select public.get_my_role()) <> 'coach' or p.client_type = 'pt'))));
create policy "iso student_leaves delete" on public.student_leaves for delete to authenticated using (false);

-- holidays: staff + senseis read; owner / partner write; a branch must be in the gym
create policy "iso holidays select" on public.holidays for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())));
create policy "iso holidays insert" on public.holidays for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and created_by is not distinct from (select auth.uid())
        and (branch_id is null or exists (select 1 from public.branches b where b.id = holidays.branch_id and b.company_id = holidays.company_id))));
create policy "iso holidays update" on public.holidays for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and (branch_id is null or exists (select 1 from public.branches b where b.id = holidays.branch_id and b.company_id = holidays.company_id))));
create policy "iso holidays delete" on public.holidays for delete to authenticated using (false);

-- message_templates: owner / partner only (they send the messages)
create policy "iso message_templates select" on public.message_templates for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
create policy "iso message_templates insert" on public.message_templates for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and updated_by is not distinct from (select auth.uid())));
create policy "iso message_templates update" on public.message_templates for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and updated_by is not distinct from (select auth.uid())));
create policy "iso message_templates delete" on public.message_templates for delete to authenticated using (false);

-- Restrictive active rule (archived logins get nothing), same as every other table
create policy "iso dojo_activities active" on public.dojo_activities as restrictive for all to authenticated
  using ((select public.is_active_login())) with check ((select public.is_active_login()));
create policy "iso batch_classes active" on public.batch_classes as restrictive for all to authenticated
  using ((select public.is_active_login())) with check ((select public.is_active_login()));
create policy "iso batch_class_activities active" on public.batch_class_activities as restrictive for all to authenticated
  using ((select public.is_active_login())) with check ((select public.is_active_login()));
create policy "iso student_leaves active" on public.student_leaves as restrictive for all to authenticated
  using ((select public.is_active_login())) with check ((select public.is_active_login()));
create policy "iso holidays active" on public.holidays as restrictive for all to authenticated
  using ((select public.is_active_login())) with check ((select public.is_active_login()));
create policy "iso message_templates active" on public.message_templates as restrictive for all to authenticated
  using ((select public.is_active_login())) with check ((select public.is_active_login()));

-- 9. Grants: read, add, update. No delete. Logged-out: nothing.
revoke all on public.dojo_activities, public.batch_classes, public.batch_class_activities,
              public.student_leaves, public.holidays, public.message_templates from anon, authenticated;
grant select, insert, update on public.dojo_activities, public.batch_classes, public.batch_class_activities,
              public.student_leaves, public.holidays, public.message_templates to authenticated;

commit;
```

Triggers use `create or replace trigger` (Postgres 14+), so Step 1's trigger part can be re-run without dropping
anything. The tables and rules are `create … if not exists` / one-off: if Step 1 fails part-way, the whole
transaction rolls back and can be run again.

## Step 2 — the dojo's 13 activities

Run once per dojo. **Change the slug** on the first line: on **Dev** use `qadojo` (QA Dojo), on **Mumbai** use
the dojo's slug (`dsska`). Re-running adds nothing twice (`on conflict do nothing`).

```sql
with c as (select id from public.companies where slug = 'qadojo')   -- Mumbai: 'dsska'
insert into public.dojo_activities (company_id, name, description, sort_order, is_default)
select c.id, v.name, v.description, v.sort_order, v.is_default
from c, (values
  ('General warm-up',           'Ankles to head',                                        1, true),
  ('Hard warm-up',              'Squats, sit-ups, knee touches, half sit-ups',           2, true),
  ('Basics',                    'Punches, blocks, attacks, formings, hammers, chops',    3, false),
  ('Kicks',                     '3 levels: high, middle, low',                           4, false),
  ('Pad work',                  'Checking punches and kicks on pads',                    5, false),
  ('Kata practice',             'Lower to higher katas',                                 6, false),
  ('Higher kicks',              'Higher kicks, multiple repetitions',                    7, false),
  ('Kumite practice',           null,                                                    8, false),
  ('Kumite higher techniques',  null,                                                    9, false),
  ('Aim of DSSKA Karate',       'Knowledge session',                                    10, false),
  ('Weapon training',           'Nunchaku and sword',                                   11, false),
  ('Tournament practice',       'Special practice for tournaments',                     12, false),
  ('Belt grading practice',     'Special practice for belt grading',                    13, false)
) as v(name, description, sort_order, is_default)
on conflict do nothing;

select name, is_default, sort_order from public.dojo_activities
where company_id = (select id from public.companies where slug = 'qadojo')   -- Mumbai: 'dsska'
order by sort_order;   -- 13 rows, first two is_default = true
```

If the `select` returns 0 rows, the slug is wrong: check it in Super Admin → Companies.

## Step 3 — checks

```sql
-- a) RLS on for all six tables
select relname, relrowsecurity from pg_class
where oid in ('public.dojo_activities'::regclass, 'public.batch_classes'::regclass, 'public.batch_class_activities'::regclass,
              'public.student_leaves'::regclass, 'public.holidays'::regclass, 'public.message_templates'::regclass)
order by relname;                                                                    -- 6 rows, all true

-- b) Five rules per table (four + active), all {authenticated}
select tablename, count(*) from pg_policies
where schemaname = 'public'
  and tablename in ('dojo_activities', 'batch_classes', 'batch_class_activities', 'student_leaves', 'holidays', 'message_templates')
group by tablename order by tablename;                                               -- 6 rows, each 5

-- c) Grants: authenticated INSERT, SELECT, UPDATE only; anon nothing
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
  and table_name in ('dojo_activities', 'batch_classes', 'batch_class_activities', 'student_leaves', 'holidays', 'message_templates')
group by table_name, grantee order by table_name;                                    -- 6 rows, authenticated: INSERT, SELECT, UPDATE

-- d) Triggers
select tgrelid::regclass, tgname from pg_trigger
where tgname in ('attendance_lock_check', 'batch_class_checks', 'batch_class_activity_checks', 'message_template_touch')
order by tgname;                                                                     -- 4 rows

-- e) Lock helper: a day 8 days back is locked, today is not
select public.class_day_locked(gen_random_uuid(), public.dojo_today() - 8) as old_locked,   -- true
       public.class_day_locked(gen_random_uuid(), public.dojo_today())     as today_locked; -- false
```

## Before the app ships

Nothing in the app reads these tables yet, so the app works exactly as today after Step 1, with one difference:
the roll call can no longer save attendance for a day more than 7 days back (the trigger refuses it with
"…locked (older than 7 days). Ask the owner to unlock it."). The unlock button comes with the app change.

## Undo

No undo SQL is written here (CLAUDE.md Rule #1). An undo would remove the six tables, the four functions and the
`attendance_lock_check` trigger, **only with Anand's explicit approval**.

## Run log

- Checked by Claude 19 Nov on a local Postgres 16 with stand-ins for auth and the existing tables: Steps 1–3 ran clean, 27 role tests matched (lock, owner-only unlock, cross-gym, holidays per branch, no delete)
- Dev: ✅ Steps 1–3 run by Anand 19 Nov, all checks passed
- Mumbai: ✅ Step 1, Step 2 (slug `dsska`, 13 rows) and Step 3 (all checks passed) run by Anand 21 Nov, before `dev` was merged into `main`

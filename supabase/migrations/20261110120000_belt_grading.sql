-- =====================================================================================
-- Belt grading, Phase 1: all grading tables + the student's current belt + the Grading toggle
--
-- Projects (check the project ref in the address bar before running):
--   1. Dev  — coachboard-dev     nnxrmaiinbmxfwzefbwx  https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
--   2. Prod — coachboard-mumbai  nptxjfvkqjuekgkspemu  https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
-- Status: ✅ RUN ON MUMBAI (prod) 10 Nov 2026 (by Anand); Step 2 checks all as expected. Do not run there again.
--         Dev: not confirmed. Run  select to_regclass('public.belt_ranks');  on dev — null = not there yet.
--         Dev has no 'dsska' company, so section 9 (seed) would stop the run: point it at the QA dojo's slug ('qadojo') for dev.
-- Anand runs this; Claude does not. ADDITIVE ONLY: 4 new tables, 2 nullable columns on
-- profiles, 1 column on companies, 1 trigger function brought up to date. No DROP / DELETE / TRUNCATE.
--
-- STEP 0 (run first, separately) — read-only checks:
--
--   -- a) the DSSKA company exists under slug 'dsska' (the seed below stops the whole run if not)
--   select id, name, slug from public.companies where slug = 'dsska';                  -- 1 row
--
--   -- b) protect_profile_columns is still the 3 Nov version (db/2026-11-03-branches-batches.md).
--   --    Expect it to contain 'batch_id' and NOT 'current_rank_id'. If it looks different, stop.
--   select pg_get_functiondef('public.protect_profile_columns()'::regprocedure);
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. belt_ranks: the gym's belt ladder
-- -------------------------------------------------------------------------------------
create table if not exists public.belt_ranks (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete cascade,
  rank_order                int  not null check (rank_order >= 0),
  belt_name                 text not null check (length(btrim(belt_name)) between 1 and 40),
  kyu                       int  check (kyu is null or kyu between 1 and 20),
  color_hex                 text not null check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  min_months_from_previous  int  check (min_months_from_previous is null or min_months_from_previous >= 0),
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  unique (company_id, rank_order),
  unique (company_id, id)          -- target of the company-matched foreign keys below
);

-- -------------------------------------------------------------------------------------
-- 2. grading_exams (Phase 2 UI; table created now)
-- -------------------------------------------------------------------------------------
create table if not exists public.grading_exams (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  exam_date   date not null,
  exam_time   time,
  venue       text default 'Kokapet — main branch',
  fee_amount  numeric check (fee_amount is null or fee_amount >= 0),
  notes       text,
  status      text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, id)
);
create index if not exists grading_exams_company_date_idx on public.grading_exams (company_id, exam_date);

create or replace function public.grading_exams_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.grading_exams_set_updated_at() from public, anon, authenticated;

create trigger grading_exams_set_updated_at
  before update on public.grading_exams
  for each row execute function public.grading_exams_set_updated_at();

-- -------------------------------------------------------------------------------------
-- 3. student_grades: promotion history (append a row every time current_rank_id changes)
-- -------------------------------------------------------------------------------------
create table if not exists public.student_grades (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  rank_id      uuid not null,
  achieved_on  date,
  source       text not null check (source in ('joined', 'backfill', 'manual', 'exam')),
  exam_id      uuid,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  -- rank and exam must belong to the same gym as the row
  constraint student_grades_rank_fkey foreign key (company_id, rank_id)
    references public.belt_ranks (company_id, id),
  constraint student_grades_exam_fkey foreign key (company_id, exam_id)
    references public.grading_exams (company_id, id)
);
create index if not exists student_grades_student_created_idx on public.student_grades (student_id, created_at desc);
create index if not exists student_grades_company_idx on public.student_grades (company_id);
create index if not exists student_grades_rank_idx on public.student_grades (rank_id);

-- -------------------------------------------------------------------------------------
-- 4. grading_exam_candidates (Phase 2 UI; table created now)
-- -------------------------------------------------------------------------------------
create table if not exists public.grading_exam_candidates (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  exam_id         uuid not null,
  student_id      uuid not null references public.profiles(id) on delete cascade,
  from_rank_id    uuid,
  to_rank_id      uuid not null,
  fee_paid        boolean,
  result          text check (result is null or result in ('pass', 'fail')),
  notice_sent_at  timestamptz,
  result_sent_at  timestamptz,
  created_at      timestamptz not null default now(),
  unique (exam_id, student_id),
  constraint grading_exam_candidates_exam_fkey foreign key (company_id, exam_id)
    references public.grading_exams (company_id, id) on delete cascade,
  constraint grading_exam_candidates_from_rank_fkey foreign key (company_id, from_rank_id)
    references public.belt_ranks (company_id, id),
  constraint grading_exam_candidates_to_rank_fkey foreign key (company_id, to_rank_id)
    references public.belt_ranks (company_id, id)
);
create index if not exists grading_exam_candidates_student_idx on public.grading_exam_candidates (student_id);
create index if not exists grading_exam_candidates_company_idx on public.grading_exam_candidates (company_id);

-- -------------------------------------------------------------------------------------
-- 5. Current belt on the student (profiles), nullable. Rank must be in the student's own gym.
-- -------------------------------------------------------------------------------------
alter table public.profiles add column if not exists current_rank_id uuid;
alter table public.profiles add column if not exists rank_achieved_on date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_current_rank_fkey') then
    alter table public.profiles
      add constraint profiles_current_rank_fkey foreign key (company_id, current_rank_id)
      references public.belt_ranks (company_id, id);
  end if;
end $$;
create index if not exists profiles_current_rank_idx on public.profiles (current_rank_id);

-- -------------------------------------------------------------------------------------
-- 6. Grading feature toggle (super admin only: protect_company_columns already blocks owners)
-- -------------------------------------------------------------------------------------
alter table public.companies add column if not exists grading_enabled boolean not null default false;

-- -------------------------------------------------------------------------------------
-- 7. RLS: four explicit rules per table
--    select : staff of the gym (owner, partners, coaches) + super admin; belt_ranks and
--             grading_exams also readable by the gym's students; a student reads only their
--             OWN grades / candidate rows (not classmates' results).
--    insert / update / delete : owner + partners of the gym, super admin.
-- -------------------------------------------------------------------------------------
alter table public.belt_ranks              enable row level security;
alter table public.grading_exams           enable row level security;
alter table public.student_grades          enable row level security;
alter table public.grading_exam_candidates enable row level security;

-- belt_ranks
create policy "iso belt_ranks select" on public.belt_ranks for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or company_id = (select public.get_my_company_id()));
create policy "iso belt_ranks insert" on public.belt_ranks for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
create policy "iso belt_ranks update" on public.belt_ranks for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
-- A rank used by a student or by history can't be deleted: the foreign keys refuse it
-- (error 23503, the app shows "This belt is in use — turn it off instead").
create policy "iso belt_ranks delete" on public.belt_ranks for delete to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));

-- grading_exams
create policy "iso grading_exams select" on public.grading_exams for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or company_id = (select public.get_my_company_id()));
create policy "iso grading_exams insert" on public.grading_exams for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
create policy "iso grading_exams update" on public.grading_exams for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));
create policy "iso grading_exams delete" on public.grading_exams for delete to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));

-- student_grades
create policy "iso student_grades select" on public.student_grades for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or student_id = (select auth.uid())
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())));
create policy "iso student_grades insert" on public.student_grades for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p where p.id = student_grades.student_id
                    and p.company_id = student_grades.company_id and p.role = 'client')));
create policy "iso student_grades update" on public.student_grades for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p where p.id = student_grades.student_id
                    and p.company_id = student_grades.company_id and p.role = 'client')));
create policy "iso student_grades delete" on public.student_grades for delete to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));

-- grading_exam_candidates
create policy "iso grading_exam_candidates select" on public.grading_exam_candidates for select to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or student_id = (select auth.uid())
    or ((select public.get_my_role()) in ('company_admin', 'partner', 'coach') and company_id = (select public.get_my_company_id())));
create policy "iso grading_exam_candidates insert" on public.grading_exam_candidates for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p where p.id = grading_exam_candidates.student_id
                    and p.company_id = grading_exam_candidates.company_id and p.role = 'client')));
create policy "iso grading_exam_candidates update" on public.grading_exam_candidates for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())))
  with check ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p where p.id = grading_exam_candidates.student_id
                    and p.company_id = grading_exam_candidates.company_id and p.role = 'client')));
create policy "iso grading_exam_candidates delete" on public.grading_exam_candidates for delete to authenticated
  using ((select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id())));

-- Explicit grants. Logged-out: nothing.
revoke all on public.belt_ranks, public.grading_exams, public.student_grades, public.grading_exam_candidates
  from anon, authenticated;
grant select, insert, update, delete
  on public.belt_ranks, public.grading_exams, public.student_grades, public.grading_exam_candidates
  to authenticated;

-- -------------------------------------------------------------------------------------
-- 8. protect_profile_columns: the 3 Nov version (branches-batches), every check kept, plus
--    clients and coaches can't change current_rank_id / rank_achieved_on (a student can't
--    promote themselves; a coach is read-only for belts).
--    The rank-in-same-gym rule is enforced by the profiles_current_rank_fkey foreign key.
-- -------------------------------------------------------------------------------------
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
          or new.batch_id is distinct from old.batch_id
          or new.current_rank_id is distinct from old.current_rank_id
          or new.rank_achieved_on is distinct from old.rank_achieved_on) then
    raise exception 'Not allowed to change membership type, archive status, primary coach, country, currency, branch, batch or belt';
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

-- -------------------------------------------------------------------------------------
-- 9. Seed the DSSKA ladder + turn Grading on for DSSKA (looked up by slug, never hardcoded)
-- -------------------------------------------------------------------------------------
do $$
declare
  v_company uuid;
begin
  select id into v_company from public.companies where slug = 'dsska';
  if v_company is null then
    raise exception 'No company with slug dsska — nothing was changed. Check Step 0a.';
  end if;

  insert into public.belt_ranks (company_id, rank_order, belt_name, kyu, color_hex, min_months_from_previous)
  values
    (v_company, 0, 'White',  null, '#FFFFFF', null),
    (v_company, 1, 'Yellow', 8,    '#FACC15', 3),
    (v_company, 2, 'Orange', 7,    '#F97316', 3),
    (v_company, 3, 'Green',  6,    '#16A34A', 3),
    (v_company, 4, 'Blue',   5,    '#2563EB', 3),
    (v_company, 5, 'Purple', 4,    '#7C3AED', 3),
    (v_company, 6, 'Brown',  3,    '#78350F', 3),
    (v_company, 7, 'Brown',  2,    '#78350F', 6)
  on conflict (company_id, rank_order) do nothing;

  update public.companies set grading_enabled = true where id = v_company;
end $$;

commit;

-- =====================================================================================
-- STEP 2 (after commit) — checks
-- =====================================================================================
-- a) RLS on for all four tables                                                       -- 4 rows, all true
-- select relname, relrowsecurity from pg_class
-- where oid in ('public.belt_ranks'::regclass, 'public.grading_exams'::regclass,
--               'public.student_grades'::regclass, 'public.grading_exam_candidates'::regclass);
--
-- b) 16 rules, all {authenticated}
-- select tablename, policyname, cmd, roles from pg_policies
-- where schemaname = 'public'
--   and tablename in ('belt_ranks', 'grading_exams', 'student_grades', 'grading_exam_candidates')
-- order by tablename, cmd;
--
-- c) Grants: authenticated DELETE/INSERT/SELECT/UPDATE on each; anon nothing
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
-- where table_schema = 'public'
--   and table_name in ('belt_ranks', 'grading_exams', 'student_grades', 'grading_exam_candidates')
--   and grantee in ('anon', 'authenticated')
-- order by table_name, grantee, privilege_type;
--
-- d) DSSKA ladder (8 rows) and toggle on
-- select r.rank_order, r.belt_name, r.kyu, r.color_hex, r.min_months_from_previous
-- from public.belt_ranks r join public.companies c on c.id = r.company_id
-- where c.slug = 'dsska' order by r.rank_order;
-- select name, grading_enabled from public.companies where slug = 'dsska';             -- true
--
-- e) New profile columns + trigger knows them
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'profiles'
--   and column_name in ('current_rank_id', 'rank_achieved_on');                        -- 2 rows
-- select pg_get_functiondef('public.protect_profile_columns()'::regprocedure) like '%current_rank_id%';  -- true
--
-- UNDO: none written here (CLAUDE.md Rule #1). Removing the tables / columns needs Anand's explicit approval.

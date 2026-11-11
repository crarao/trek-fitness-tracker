-- =====================================================================================
-- Belt grading, Phase 2: exams, candidates, Save results / Undo, Black belt (dan)
--
-- 1. Run in: Dev  — coachboard-dev     nnxrmaiinbmxfwzefbwx  https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
-- 2. After testing on the dev link, run in: Mumbai (prod) — coachboard-mumbai  nptxjfvkqjuekgkspemu
--                                           https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
-- Check the project ref in the address bar before pressing Run.
-- Status: NOT RUN YET (dev or prod).
--
-- Anand runs this; Claude does not. ADDITIVE ONLY: 5 nullable columns, 1 check rule, 1 trigger,
-- 2 database functions. No DROP / DELETE / TRUNCATE, no renames, no type changes.
--
-- What each part is for (decisions of 11 Nov):
--   1. grading_exam_candidates.removed_at   untick a student = mark removed (never erased)
--      grading_exam_candidates.cancel_sent_at  "Tell parent: cancelled" was sent
--   2. student_grades.voided_at / voided_by  Undo results hides the exam's history row (never erased)
--   3. belt_ranks.dan                        Black belt = "1st dan" (kyu and dan never both set)
--   4. trigger on candidates                 one scheduled exam per student; a completed / cancelled
--                                            exam's list and results are locked
--   5. save_grading_results(exam)            Save results: all-or-nothing, safe to run twice
--   6. undo_grading_results(exam)            Undo results: belts back, exam back to "scheduled"
--
-- STEP 0 (run first, separately) — read-only checks:
--
--   -- a) Phase 1 tables are there                                                     -- 4 rows
--   select table_name from information_schema.tables where table_schema = 'public'
--     and table_name in ('belt_ranks', 'grading_exams', 'student_grades', 'grading_exam_candidates');
--
--   -- b) this file has not run yet                                                    -- 0 rows
--   select table_name, column_name from information_schema.columns where table_schema = 'public'
--     and column_name in ('removed_at', 'cancel_sent_at', 'voided_at', 'voided_by', 'dan')
--     and table_name in ('grading_exam_candidates', 'student_grades', 'belt_ranks');
--
--   -- c) no exams yet (the new lock rule only matters for new rows; expect 0 on both projects)
--   select count(*) from public.grading_exams;
-- =====================================================================================

begin;

-- -------------------------------------------------------------------------------------
-- 1. Candidates: removed (instead of erasing the row) + cancellation notice sent
-- -------------------------------------------------------------------------------------
alter table public.grading_exam_candidates add column if not exists removed_at     timestamptz;
alter table public.grading_exam_candidates add column if not exists cancel_sent_at timestamptz;

-- -------------------------------------------------------------------------------------
-- 2. History: Undo marks the exam's row as undone (the app hides it); nothing is erased
-- -------------------------------------------------------------------------------------
alter table public.student_grades add column if not exists voided_at timestamptz;
alter table public.student_grades add column if not exists voided_by uuid references public.profiles(id) on delete set null;

-- -------------------------------------------------------------------------------------
-- 3. Black belt: dan (1st dan, 2nd dan …). A belt has a kyu, a dan, or neither (White)
-- -------------------------------------------------------------------------------------
alter table public.belt_ranks add column if not exists dan int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'belt_ranks_dan_check') then
    alter table public.belt_ranks add constraint belt_ranks_dan_check
      check (dan is null or (dan between 1 and 10 and kyu is null));
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 4. Candidate rules (checked on every insert / update from the app):
--    a) a student is on at most one SCHEDULED exam at a time (removed rows don't count)
--    b) once an exam is completed or cancelled its list and results are locked; only
--       fee_paid and the "sent" times can still change (Undo reopens the exam first)
-- -------------------------------------------------------------------------------------
create or replace function public.grading_candidate_checks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  select status into v_status from public.grading_exams where id = new.exam_id;

  if v_status is distinct from 'scheduled' then
    if tg_op = 'INSERT'
       or new.result       is distinct from old.result
       or new.removed_at   is distinct from old.removed_at
       or new.from_rank_id is distinct from old.from_rank_id
       or new.to_rank_id   is distinct from old.to_rank_id
       or new.student_id   is distinct from old.student_id then
      raise exception 'This exam is % — its list and results can''t be changed', coalesce(v_status, 'missing');
    end if;
  end if;

  if new.removed_at is null and exists (
      select 1 from public.grading_exam_candidates c
      join public.grading_exams e on e.id = c.exam_id
      where c.student_id = new.student_id and c.exam_id <> new.exam_id
        and c.removed_at is null and e.status = 'scheduled') then
    raise exception 'This student is already on another scheduled exam';
  end if;

  return new;
end $$;
revoke execute on function public.grading_candidate_checks() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'grading_candidate_checks'
                 and tgrelid = 'public.grading_exam_candidates'::regclass) then
    create trigger grading_candidate_checks
      before insert or update on public.grading_exam_candidates
      for each row execute function public.grading_candidate_checks();
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 5. Save results — one step, all or nothing.
--    Owner / partner of the exam's gym (or super admin). Every candidate on the list needs
--    a result. For each PASS: belt = to_rank, belt since = exam date, + history row
--    (source 'exam'). FAIL: nothing changes. Then the exam is 'completed'.
--    Safe to run twice: a student already on to_rank with this exam's history row is skipped;
--    a completed exam returns ok without changing anything.
--    If a passing student's belt changed since they were picked, NOTHING is saved and their
--    names come back (decision 4a) so the owner can fix them.
--    Returns jsonb: {ok, promoted, failed, skipped} or {ok:false, error, names?}
-- -------------------------------------------------------------------------------------
create or replace function public.save_grading_results(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exam    public.grading_exams%rowtype;
  v_role    text := public.get_my_role();
  v_names   text[];
  v_promoted int := 0;
  v_skipped  int := 0;
  v_failed   int := 0;
  r record;
begin
  select * into v_exam from public.grading_exams where id = p_exam_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (v_role = 'super_admin'
          or (v_role in ('company_admin', 'partner') and v_exam.company_id = public.get_my_company_id())) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_exam.status = 'completed' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_exam.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'cancelled'); end if;

  if not exists (select 1 from public.grading_exam_candidates
                 where exam_id = p_exam_id and removed_at is null) then
    return jsonb_build_object('ok', false, 'error', 'no_candidates');
  end if;

  -- Every candidate needs Pass or Fail
  select array_agg(p.full_name order by p.full_name) into v_names
  from public.grading_exam_candidates c join public.profiles p on p.id = c.student_id
  where c.exam_id = p_exam_id and c.removed_at is null and c.result is null;
  if v_names is not null then
    return jsonb_build_object('ok', false, 'error', 'missing_results', 'names', to_jsonb(v_names));
  end if;

  -- Passing students whose belt is no longer the one they were picked with (and not already done)
  select array_agg(p.full_name order by p.full_name) into v_names
  from public.grading_exam_candidates c join public.profiles p on p.id = c.student_id
  where c.exam_id = p_exam_id and c.removed_at is null and c.result = 'pass'
    and p.current_rank_id is distinct from c.from_rank_id
    and not (p.current_rank_id = c.to_rank_id and exists (
      select 1 from public.student_grades g where g.student_id = c.student_id
        and g.exam_id = p_exam_id and g.voided_at is null));
  if v_names is not null then
    return jsonb_build_object('ok', false, 'error', 'belt_changed', 'names', to_jsonb(v_names));
  end if;

  for r in
    select c.student_id, c.to_rank_id, c.result, p.current_rank_id
    from public.grading_exam_candidates c join public.profiles p on p.id = c.student_id
    where c.exam_id = p_exam_id and c.removed_at is null
    for update of p
  loop
    if r.result = 'fail' then
      v_failed := v_failed + 1;
    elsif r.current_rank_id = r.to_rank_id and exists (
        select 1 from public.student_grades g where g.student_id = r.student_id
          and g.exam_id = p_exam_id and g.voided_at is null) then
      v_skipped := v_skipped + 1;
    else
      update public.profiles
        set current_rank_id = r.to_rank_id, rank_achieved_on = v_exam.exam_date
        where id = r.student_id;
      insert into public.student_grades (company_id, student_id, rank_id, achieved_on, source, exam_id, created_by)
        values (v_exam.company_id, r.student_id, r.to_rank_id, v_exam.exam_date, 'exam', p_exam_id, auth.uid());
      v_promoted := v_promoted + 1;
    end if;
  end loop;

  update public.grading_exams set status = 'completed' where id = p_exam_id;

  return jsonb_build_object('ok', true, 'promoted', v_promoted, 'failed', v_failed, 'skipped', v_skipped);
end $$;

-- -------------------------------------------------------------------------------------
-- 6. Undo results — one step, all or nothing.
--    Only for a completed exam, and only while nobody's belt changed after it: each passing
--    student must still be on to_rank with this exam's row as their latest history row.
--    Otherwise NOTHING changes and their names come back.
--    Then: the exam's history rows are marked undone (voided_at), each passing student goes
--    back to from_rank (belt since = that belt's latest remaining history date), and the exam
--    is 'scheduled' again. Pass / Fail marks stay, so one can be corrected and saved again.
-- -------------------------------------------------------------------------------------
create or replace function public.undo_grading_results(p_exam_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_exam   public.grading_exams%rowtype;
  v_role   text := public.get_my_role();
  v_names  text[];
  v_undone int := 0;
  r record;
begin
  select * into v_exam from public.grading_exams where id = p_exam_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not (v_role = 'super_admin'
          or (v_role in ('company_admin', 'partner') and v_exam.company_id = public.get_my_company_id())) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  if v_exam.status <> 'completed' then return jsonb_build_object('ok', false, 'error', 'not_completed'); end if;

  -- Passing students whose belt changed after the exam (another change on top of it)
  select array_agg(p.full_name order by p.full_name) into v_names
  from public.student_grades g join public.profiles p on p.id = g.student_id
  where g.exam_id = p_exam_id and g.voided_at is null
    and (p.current_rank_id is distinct from g.rank_id
         or exists (select 1 from public.student_grades later
                    where later.student_id = g.student_id and later.voided_at is null
                      and later.created_at > g.created_at));
  if v_names is not null then
    return jsonb_build_object('ok', false, 'error', 'belt_changed_since', 'names', to_jsonb(v_names));
  end if;

  for r in
    select g.id as grade_id, g.student_id, c.from_rank_id
    from public.student_grades g
    join public.grading_exam_candidates c on c.exam_id = g.exam_id and c.student_id = g.student_id
    where g.exam_id = p_exam_id and g.voided_at is null
  loop
    update public.student_grades set voided_at = now(), voided_by = auth.uid() where id = r.grade_id;
    update public.profiles p
      set current_rank_id = r.from_rank_id,
          rank_achieved_on = (select g2.achieved_on from public.student_grades g2
                              where g2.student_id = r.student_id and g2.rank_id = r.from_rank_id
                                and g2.voided_at is null
                              order by g2.created_at desc limit 1)
      where p.id = r.student_id;
    v_undone := v_undone + 1;
  end loop;

  update public.grading_exams set status = 'scheduled' where id = p_exam_id;

  return jsonb_build_object('ok', true, 'undone', v_undone);
end $$;

revoke execute on function public.save_grading_results(uuid), public.undo_grading_results(uuid) from public, anon;
grant  execute on function public.save_grading_results(uuid), public.undo_grading_results(uuid) to authenticated;

commit;

-- =====================================================================================
-- STEP 2 (after commit) — checks
-- =====================================================================================
-- a) the 5 new columns                                                                -- 5 rows
-- select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'
--   and column_name in ('removed_at', 'cancel_sent_at', 'voided_at', 'voided_by', 'dan')
--   and table_name in ('grading_exam_candidates', 'student_grades', 'belt_ranks') order by 1, 2;
--
-- b) trigger on candidates                                                            -- 1 row
-- select tgname from pg_trigger where tgrelid = 'public.grading_exam_candidates'::regclass and not tgisinternal;
--
-- c) the two functions, callable by authenticated only                                -- 2 rows: true, false
-- select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
--        has_function_privilege('anon', p.oid, 'execute') as anon
-- from pg_proc p where p.pronamespace = 'public'::regnamespace
--   and p.proname in ('save_grading_results', 'undo_grading_results');
--
-- d) a logged-out / wrong-gym call is refused (SQL Editor runs as postgres with no login,
--    so get_my_role() is empty):                                                      -- {"ok": false, "error": "not_found"}
-- select public.save_grading_results(gen_random_uuid());
--
-- UNDO: none written here (CLAUDE.md Rule #1). Removing columns / functions needs Anand's explicit approval.

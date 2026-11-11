-- =====================================================================================
-- Belt grading: a fee per belt on an exam + Brown 1st kyu on the ladder
--
-- 1. Run in: Dev  — coachboard-dev     nnxrmaiinbmxfwzefbwx  https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
-- 2. After testing on the dev link, run in: Mumbai (prod) — coachboard-mumbai  nptxjfvkqjuekgkspemu
--                                           https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
--    (Mumbai only AFTER 20261111120000_belt_grading_phase2.sql has run there.)
-- Check the project ref in the address bar before pressing Run.
-- Status: NOT RUN YET (dev or prod).
--
-- Anand runs this; Claude does not. ADDITIVE ONLY: 1 nullable column, 1 check rule, 1 new belt row per gym.
-- No DROP / DELETE / TRUNCATE, no renames, no type changes.
--
--   1. grading_exams.belt_fees: the fee per belt graded TO, fixed when the exam is scheduled
--      ({"<belt id>": 800, …}; a belt not listed = the exam's fee_amount). Decision 12 Nov: DSSKA
--      charges the same fee up to Purple and more for the Brown belts.
--   2. Brown – 1st kyu after Brown – 2nd kyu (rank_order 8), 6 months after 2nd kyu, for every gym
--      whose ladder ends with Brown 2nd kyu at rank_order 7 (DSSKA on prod, QA Dojo on dev).
--      Nobody is moved onto it; it only becomes the next belt for Brown 2nd kyu students.
--
-- STEP 0 (read-only, run first) — which gyms get Brown 1st kyu                      -- dev: QA Dojo; prod: DSSKA
--   select c.name, c.slug from public.belt_ranks r join public.companies c on c.id = r.company_id
--   where r.rank_order = 7 and r.belt_name = 'Brown' and r.kyu = 2
--     and not exists (select 1 from public.belt_ranks x where x.company_id = r.company_id and x.rank_order = 8);
-- =====================================================================================

begin;

alter table public.grading_exams add column if not exists belt_fees jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'grading_exams_belt_fees_check') then
    alter table public.grading_exams add constraint grading_exams_belt_fees_check
      check (belt_fees is null or jsonb_typeof(belt_fees) = 'object');
  end if;
end $$;

insert into public.belt_ranks (company_id, rank_order, belt_name, kyu, color_hex, min_months_from_previous)
select r.company_id, 8, 'Brown', 1, '#78350F', 6
from public.belt_ranks r
where r.rank_order = 7 and r.belt_name = 'Brown' and r.kyu = 2
on conflict (company_id, rank_order) do nothing;

commit;

-- =====================================================================================
-- STEP 2 (after commit) — checks
-- =====================================================================================
-- a) the new column                                                                    -- 1 row: jsonb
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'grading_exams' and column_name = 'belt_fees';
--
-- b) the ladder now ends with Brown 2nd kyu, Brown 1st kyu                             -- 9 rows per gym from Step 0
-- select c.name, r.rank_order, r.belt_name, r.kyu, r.min_months_from_previous
-- from public.belt_ranks r join public.companies c on c.id = r.company_id
-- where c.grading_enabled order by c.name, r.rank_order;
--
-- UNDO: none written here (CLAUDE.md Rule #1). Turning the belt off (is_active = false) hides it without deleting.

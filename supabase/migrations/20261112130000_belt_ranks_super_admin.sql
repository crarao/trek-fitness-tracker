-- =====================================================================================
-- Belt ladder: only super admin adds / changes belts (decided 11 Nov: belts are part of setting up a dojo)
--
-- 1. Run in: Dev  — coachboard-dev     nnxrmaiinbmxfwzefbwx  https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
-- 2. After testing on the dev link, run in: Mumbai (prod) — coachboard-mumbai  nptxjfvkqjuekgkspemu
--                                           https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
-- Check the project ref in the address bar before pressing Run.
-- Status: NOT RUN YET (dev or prod).
--
-- Anand runs this; Claude does not. Nothing is dropped or deleted: the three existing write rules on belt_ranks
-- (from 20261110120000_belt_grading.sql) are narrowed in place with ALTER POLICY, from "owner / partner of the gym
-- or super admin" to "super admin". Reading belts is unchanged (the whole gym). The app has never let owners edit
-- belts; this makes the database agree. Super Admin → Companies → Edit → Belt grading (app/belts-editor.tsx) writes them.
-- =====================================================================================

begin;

alter policy "iso belt_ranks insert" on public.belt_ranks
  with check ((select public.get_my_role()) = 'super_admin');

alter policy "iso belt_ranks update" on public.belt_ranks
  using ((select public.get_my_role()) = 'super_admin')
  with check ((select public.get_my_role()) = 'super_admin');

-- The app never deletes belts (turn off instead); a belt in use can't be deleted anyway (foreign keys)
alter policy "iso belt_ranks delete" on public.belt_ranks
  using ((select public.get_my_role()) = 'super_admin');

commit;

-- =====================================================================================
-- STEP 2 (after commit) — check: the three write rules mention only super_admin          -- 4 rows
-- (copy these lines WITHOUT the leading "-- ")
-- =====================================================================================
-- select policyname, cmd, qual, with_check from pg_policies
-- where schemaname = 'public' and tablename = 'belt_ranks' order by cmd;
--
-- Expect: select = super_admin OR the gym (unchanged); insert / update / delete = super_admin only.
-- UNDO: none written here (CLAUDE.md Rule #1).

# 30 Oct 2026 — RLS hardening: company isolation — RUN BY ANAND 30 OCT (~11:59 IST)

**Status:** applied in Supabase (Mumbai project) on 30 Oct. Cross-company test (two throwaway gyms, every role, rolled back) passed **117 / 117** on production right after.
Replaced 38 overlapping rules on `companies`, `profiles`, `memberships`, `weekly_plans`, `logged_sessions`, `session_feedback` with 4 per table (`iso <table> <action>`); removals approved by Anand 30 Oct.
Also: helpers made `STABLE`; new `gym_staff()` (staff names for coaches, used by `lib/gym-staff.ts`); `anon` has no table rights except the 5 branding columns of `companies`; `authenticated` lost TRUNCATE / REFERENCES / TRIGGER.
Unchanged: `leads`, `ai_usage`, `contact_requests`, `session_metrics`, `client_goals`, both `protect_*` triggers, `pt_membership_status()`.

The rollback script and the test script are kept outside this public repo (Anand has both).

```sql
-- RLS hardening: company isolation (ROADMAP: RLS hardening task, 30 Oct 2026)
-- Run ONCE in the Supabase SQL editor (Mumbai project). One transaction: it all applies or nothing does.
-- Built from the live audit of 30 Oct (46 rules). Do NOT commit this to the public repo until it has been applied.
--
-- What it does
--  1. get_my_role() / get_my_company_id(): same body, now STABLE (security definer, search_path=public kept).
--  2. New function gym_staff(): owner / partner / coach names of the caller's gym (no phone or email), for coaches.
--  3. Replaces 38 overlapping rules on companies, profiles, memberships, weekly_plans, logged_sessions,
--     session_feedback with 4 rules per table (select / insert / update / delete), all scoped to the caller's gym.
--     The new rules are created in the SAME transaction, so there is no moment without rules (no silent save failures).
--     Unchanged: leads (already correct), ai_usage, contact_requests, session_metrics, client_goals,
--     "Public can read company branding", the two protect_* triggers, pt_membership_status().
--  4. Grants: anon gets nothing except the 5 branding columns of companies; authenticated loses TRUNCATE /
--     REFERENCES / TRIGGER (RLS doesn't cover TRUNCATE). Rights the app uses are kept.
--
-- Fixes from supabase/rls-audit.md: P1 (staff inserting profiles: removed, approved by Anand 30 Oct), P2, P3, P4,
-- P5, G1 (with the app's gym_staff() change), H1, H2, H3.
-- Undo: rls-rollback.sql (restores the exact 38 rules and the grants).

begin;

-- 1. Helpers: STABLE (same body)
create or replace function public.get_my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() limit 1;
$$;

create or replace function public.get_my_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from profiles where id = auth.uid() limit 1;
$$;

-- 2. Staff names for the caller's gym (owner, partners and coaches only; clients get nothing)
create or replace function public.gym_staff()
returns table (id uuid, full_name text, role text, archived_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.archived_at
  from profiles p
  where p.company_id = public.get_my_company_id()
    and p.role in ('company_admin', 'partner', 'coach')
    and public.get_my_role() in ('company_admin', 'partner', 'coach')
  order by p.full_name;
$$;
revoke execute on function public.gym_staff() from public, anon;
grant execute on function public.gym_staff() to authenticated;

-- 3a. Rules replaced (exact names from the live audit; all restored by rls-rollback.sql)
drop policy if exists "Super admin can do all on companies" on public.companies;  -- ALL to public
drop policy if exists "Users can read own company" on public.companies;  -- SELECT to authenticated
drop policy if exists "Company admin can update own company" on public.companies;  -- UPDATE to authenticated
drop policy if exists "Company admin can delete client sessions" on public.logged_sessions;  -- DELETE to authenticated
drop policy if exists "Clients can insert own sessions" on public.logged_sessions;  -- INSERT to public
drop policy if exists "Coaches log PT client sessions" on public.logged_sessions;  -- INSERT to authenticated
drop policy if exists "Staff can log client sessions" on public.logged_sessions;  -- INSERT to authenticated
drop policy if exists "Clients can read own sessions" on public.logged_sessions;  -- SELECT to public
drop policy if exists "Coaches read PT client sessions" on public.logged_sessions;  -- SELECT to authenticated
drop policy if exists "Company admin can read client sessions" on public.logged_sessions;  -- SELECT to public
drop policy if exists "Partners can read client sessions" on public.logged_sessions;  -- SELECT to authenticated
drop policy if exists "Coaches update PT client sessions" on public.logged_sessions;  -- UPDATE to authenticated
drop policy if exists "Staff can update client sessions" on public.logged_sessions;  -- UPDATE to authenticated
drop policy if exists "Staff manage own company memberships" on public.memberships;  -- ALL to authenticated
drop policy if exists "Super admin manages all memberships" on public.memberships;  -- ALL to authenticated
drop policy if exists "Clients read own memberships" on public.memberships;  -- SELECT to authenticated
drop policy if exists "Super admin can manage all profiles" on public.profiles;  -- ALL to authenticated
drop policy if exists "Company admin can delete client profiles" on public.profiles;  -- DELETE to authenticated
drop policy if exists "Staff can insert profiles in own company" on public.profiles;  -- INSERT to authenticated
drop policy if exists "Coaches read PT clients and staff" on public.profiles;  -- SELECT to authenticated
drop policy if exists "Staff can read profiles in own company" on public.profiles;  -- SELECT to authenticated
drop policy if exists "Users can read own profile" on public.profiles;  -- SELECT to public
drop policy if exists "Clients can update own profile" on public.profiles;  -- UPDATE to public
drop policy if exists "Company admin can update client profiles" on public.profiles;  -- UPDATE to authenticated
drop policy if exists "Partners can update client profiles" on public.profiles;  -- UPDATE to authenticated
drop policy if exists "Company admin can manage session feedback" on public.session_feedback;  -- ALL to public
drop policy if exists "Partners can manage session feedback" on public.session_feedback;  -- ALL to authenticated
drop policy if exists "Staff can delete session feedback" on public.session_feedback;  -- DELETE to authenticated
drop policy if exists "Clients can insert own feedback" on public.session_feedback;  -- INSERT to public
drop policy if exists "Clients can read own feedback" on public.session_feedback;  -- SELECT to public
drop policy if exists "Coaches read PT client feedback" on public.session_feedback;  -- SELECT to authenticated
drop policy if exists "Company admin can manage client plans" on public.weekly_plans;  -- ALL to public
drop policy if exists "Partners can manage client plans" on public.weekly_plans;  -- ALL to authenticated
drop policy if exists "Staff can delete weekly plans" on public.weekly_plans;  -- DELETE to authenticated
drop policy if exists "Coaches add PT client plans" on public.weekly_plans;  -- INSERT to authenticated
drop policy if exists "Clients can read own plans" on public.weekly_plans;  -- SELECT to public
drop policy if exists "Coaches read PT client plans" on public.weekly_plans;  -- SELECT to authenticated
drop policy if exists "Coaches update PT client plans" on public.weekly_plans;  -- UPDATE to authenticated

-- 3b. New rules: one per table and action
-- ===== companies =====
create policy "iso companies select" on public.companies for select to authenticated
  using (id = (select public.get_my_company_id()) or (select public.get_my_role()) = 'super_admin');
create policy "iso companies insert" on public.companies for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin');
-- Owner may update their own row; trigger protect_company_columns limits that to logo_url / banner_url
create policy "iso companies update" on public.companies for update to authenticated
  using ((select public.get_my_role()) = 'super_admin'
         or (id = (select public.get_my_company_id()) and (select public.get_my_role()) = 'company_admin'))
  with check ((select public.get_my_role()) = 'super_admin'
         or (id = (select public.get_my_company_id()) and (select public.get_my_role()) = 'company_admin'));
create policy "iso companies delete" on public.companies for delete to authenticated
  using ((select public.get_my_role()) = 'super_admin');
-- kept as is: "Public can read company branding" (anon; the column grant limits it to 5 branding columns)

-- ===== profiles =====
create policy "iso profiles select" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.get_my_role()) = 'super_admin'
    or (company_id = (select public.get_my_company_id())
        and ((select public.get_my_role()) in ('company_admin', 'partner')
             or ((select public.get_my_role()) = 'coach'
                 and ((role = 'client' and client_type = 'pt') or role = 'coach'))))
  );
-- Profiles are created only by the server (create-user, secret key). Browser: super admin only.
create policy "iso profiles insert" on public.profiles for insert to authenticated
  with check ((select public.get_my_role()) = 'super_admin');
-- Own row (trigger protect_profile_columns locks role / company and, for clients + coaches, PT / archive / primary coach);
-- owner + partners: clients of their gym; super admin: all
create policy "iso profiles update" on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    or (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id()) and role = 'client')
  )
  with check (
    id = (select auth.uid())
    or (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id()) and role = 'client')
  );
-- Browser deletes only partner logins from /admin; client deletes go through the server (delete-user)
create policy "iso profiles delete" on public.profiles for delete to authenticated
  using ((select public.get_my_role()) = 'super_admin');

-- ===== memberships =====
create policy "iso memberships select" on public.memberships for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id()))
  );
create policy "iso memberships insert" on public.memberships for insert to authenticated
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p
                    where p.id = memberships.profile_id and p.company_id = (select public.get_my_company_id())))
  );
create policy "iso memberships update" on public.memberships for update to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id()))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and company_id = (select public.get_my_company_id())
        and exists (select 1 from public.profiles p
                    where p.id = memberships.profile_id and p.company_id = (select public.get_my_company_id())))
  );
create policy "iso memberships delete" on public.memberships for delete to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner') and company_id = (select public.get_my_company_id()))
  );

-- ===== weekly_plans (no company_id: through client_id → profiles) =====
create policy "iso weekly_plans select" on public.weekly_plans for select to authenticated
  using (
    client_id = (select auth.uid())
    or (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );
create policy "iso weekly_plans insert" on public.weekly_plans for insert to authenticated
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );
create policy "iso weekly_plans update" on public.weekly_plans for update to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );
create policy "iso weekly_plans delete" on public.weekly_plans for delete to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = weekly_plans.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
  );

-- ===== logged_sessions (no company_id: through client_id → profiles) =====
create policy "iso logged_sessions select" on public.logged_sessions for select to authenticated
  using (
    client_id = (select auth.uid())
    or (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );
-- Client: own sessions, logged_by empty or themselves. Staff / coach: logged_by = themselves.
-- weekly_plan_id, if set, must be a plan of the same client.
create policy "iso logged_sessions insert" on public.logged_sessions for insert to authenticated
  with check (
    (weekly_plan_id is null
     or exists (select 1 from public.weekly_plans w where w.id = logged_sessions.weekly_plan_id and w.client_id = logged_sessions.client_id))
    and (
      (select public.get_my_role()) = 'super_admin'
      or ((select public.get_my_role()) = 'client' and client_id = (select auth.uid())
          and (logged_by is null or logged_by = (select auth.uid())))
      or ((select public.get_my_role()) in ('company_admin', 'partner') and logged_by = (select auth.uid())
          and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                      and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
      or ((select public.get_my_role()) = 'coach' and logged_by = (select auth.uid())
          and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                      and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
    )
  );
create policy "iso logged_sessions update" on public.logged_sessions for update to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client' and p.client_type = 'pt'))
  );
create policy "iso logged_sessions delete" on public.logged_sessions for delete to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.profiles p where p.id = logged_sessions.client_id
                    and p.company_id = (select public.get_my_company_id()) and p.role = 'client'))
  );

-- ===== session_feedback (through session_id → logged_sessions → profiles) =====
create policy "iso session_feedback select" on public.session_feedback for select to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or exists (select 1 from public.logged_sessions s where s.id = session_feedback.session_id and s.client_id = (select auth.uid()))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_feedback.session_id and p.company_id = (select public.get_my_company_id())))
    or ((select public.get_my_role()) = 'coach'
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_feedback.session_id and p.company_id = (select public.get_my_company_id())
                      and p.role = 'client' and p.client_type = 'pt'))
  );
-- Client: star rating on their own session only (no coach feedback text). Staff: their gym.
create policy "iso session_feedback insert" on public.session_feedback for insert to authenticated
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) = 'client' and admin_feedback is null
        and exists (select 1 from public.logged_sessions s where s.id = session_feedback.session_id and s.client_id = (select auth.uid())))
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_feedback.session_id and p.company_id = (select public.get_my_company_id())))
  );
create policy "iso session_feedback update" on public.session_feedback for update to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_feedback.session_id and p.company_id = (select public.get_my_company_id())))
  )
  with check (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_feedback.session_id and p.company_id = (select public.get_my_company_id())))
  );
create policy "iso session_feedback delete" on public.session_feedback for delete to authenticated
  using (
    (select public.get_my_role()) = 'super_admin'
    or ((select public.get_my_role()) in ('company_admin', 'partner')
        and exists (select 1 from public.logged_sessions s join public.profiles p on p.id = s.client_id
                    where s.id = session_feedback.session_id and p.company_id = (select public.get_my_company_id())))
  );

-- 4. Grants
revoke all on all tables in schema public from anon;
grant select (name, slug, logo_url, banner_url, business_type) on public.companies to anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

commit;

-- Check (run after): every table below should show exactly 4 "iso …" rules (companies: 4 + the anon branding rule)
-- select tablename, count(*) filter (where policyname like 'iso %') as iso_rules, count(*) as all_rules
-- from pg_policies where schemaname = 'public' group by tablename order by tablename;
```

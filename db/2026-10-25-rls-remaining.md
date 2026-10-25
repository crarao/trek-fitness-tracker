# RLS — remaining rules (ROADMAP #1)

Prepared 25 Oct 2026. Run **one step at a time** in Supabase → SQL Editor, then do that step's test in the app before moving on. Every step runs inside `begin … commit`, so it either fully applies or not at all. Every step has an **Undo** that restores exactly what was there before.

Already done on 24 Oct (not repeated here): `memberships` RLS + 3 rules, and the `protect_profile_columns` trigger (role / company lock).

**You need logins for:** super admin, a coach (company admin), a partner (staff) and a client — ideally all in one test company.

## ⚠️ Removals that need Anand's OK (no-deletion rule)

Steps 2–5 replace rules that are too loose. These existing policies are removed and replaced by tighter ones; each step's Undo puts them back exactly:

| Step | Table | Policy removed | Why |
|---|---|---|---|
| 2 | companies | `Company admin can update own company` | Lets **any** member (incl. clients) edit their gym's trial, limits, active status |
| 3 | profiles | `Super admin can read all profiles` | Also lets clients read every profile in their gym |
| 3 | profiles | `Users can read same company profiles` | Same: clients read other members' phones, medical notes |
| 3 | profiles | `Company admin can insert profiles` | No role check (any member could insert). App inserts via the server, so staff-only is enough |
| 4 | companies | `Anyone can read company branding` | Lets anyone (even logged out) read every company's emails, notes, trial info |
| 4 | companies | table-level `SELECT` grant for `anon` | Replaced by a column-level grant (name, slug, logo, banner, business type only) |
| 5 | weekly_plans | `Company admin can delete weekly plans` | No role check: a client could delete plans in their gym |
| 5 | session_feedback | `Company admin can delete session feedback` | No role check: a client could delete coach feedback |

Step 1 only **adds** rules (no approval needed).

---

## Step 0 — check (read-only)

```sql
select proname, prosecdef as security_definer
from pg_proc where proname in ('get_my_role', 'get_my_company_id', 'protect_profile_columns');

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'companies'
  and column_name in ('slug', 'logo_url', 'banner_url', 'business_type', 'name');
```

**Expected:** 3 functions, `security_definer = true` for all; 5 column names. If not, stop and send a screenshot.

---

## Step 1 — Partners (staff) can work like the coach · adds only

Today partner logins open `/company` but can't assign plans, see sessions, give feedback or edit client profiles (rules only mention `company_admin`).

```sql
begin;

create policy "Partners can update client profiles" on public.profiles
  for update to authenticated
  using (public.get_my_role() = 'partner' and company_id = public.get_my_company_id() and role = 'client')
  with check (public.get_my_role() = 'partner' and company_id = public.get_my_company_id() and role = 'client');

create policy "Partners can manage client plans" on public.weekly_plans
  for all to authenticated
  using (public.get_my_role() = 'partner'
         and client_id in (select id from public.profiles where company_id = public.get_my_company_id()))
  with check (public.get_my_role() = 'partner'
         and client_id in (select id from public.profiles where company_id = public.get_my_company_id()));

create policy "Partners can read client sessions" on public.logged_sessions
  for select to authenticated
  using (public.get_my_role() = 'partner'
         and client_id in (select id from public.profiles where company_id = public.get_my_company_id()));

create policy "Partners can manage session feedback" on public.session_feedback
  for all to authenticated
  using (public.get_my_role() = 'partner' and session_id in (
           select ls.id from public.logged_sessions ls
           join public.profiles p on p.id = ls.client_id
           where p.company_id = public.get_my_company_id()))
  with check (public.get_my_role() = 'partner' and session_id in (
           select ls.id from public.logged_sessions ls
           join public.profiles p on p.id = ls.client_id
           where p.company_id = public.get_my_company_id()));

commit;
```

**Test (partner login):** open a PT client → Plans → assign a plan (green message, card appears) → Sessions tab shows sessions → write feedback on one.
**Test (coach):** nothing changed — assign a plan still works.

**Undo:**
```sql
begin;
drop policy "Partners can update client profiles" on public.profiles;
drop policy "Partners can manage client plans" on public.weekly_plans;
drop policy "Partners can read client sessions" on public.logged_sessions;
drop policy "Partners can manage session feedback" on public.session_feedback;
commit;
```

---

## Step 2 — Gym settings: only the coach, and only the logo · ⚠️ removes 1 policy

Today any member of a gym (incl. clients) can change that gym's trial end, client limit, active status, flags. After this: only the gym's **company admin** can update the company row, and only `logo_url` / `banner_url`. Everything else is super admin (or the server) only.

```sql
begin;

drop policy "Company admin can update own company" on public.companies;

create policy "Company admin can update own company" on public.companies
  for update to authenticated
  using (id = public.get_my_company_id() and public.get_my_role() = 'company_admin')
  with check (id = public.get_my_company_id() and public.get_my_role() = 'company_admin');

create or replace function public.protect_company_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;                 -- server-side API routes
  if public.get_my_role() = 'super_admin' then return new; end if;
  -- everyone else may only change the logo / banner (updated_at ignored in case another trigger sets it)
  if (to_jsonb(new) - 'logo_url' - 'banner_url' - 'updated_at')
     is distinct from (to_jsonb(old) - 'logo_url' - 'banner_url' - 'updated_at') then
    raise exception 'Only CoachBoard can change these gym settings';
  end if;
  return new;
end $$;

create trigger protect_company_columns
  before update on public.companies
  for each row execute function public.protect_company_columns();

commit;
```

**Test (coach):** Settings → change the logo → *Logo saved ✓*.
**Test (super admin):** /admin → Edit a test company → change the client limit → *Company saved ✓*.

**Undo:**
```sql
begin;
drop trigger protect_company_columns on public.companies;
drop policy "Company admin can update own company" on public.companies;
create policy "Company admin can update own company" on public.companies
  for update to public
  using (id = public.get_my_company_id())
  with check (id = public.get_my_company_id());
commit;
```

---

## Step 3 — Profiles: clients see only themselves · ⚠️ removes 3 policies

Today a client can read every profile in their gym (phones, medical conditions). After this: clients read only their own profile; coach + partners read their gym; super admin reads/manages all. Clients also can't change their own membership type (PT) or archive status.

```sql
begin;

drop policy "Super admin can read all profiles" on public.profiles;
drop policy "Users can read same company profiles" on public.profiles;
drop policy "Company admin can insert profiles" on public.profiles;
-- kept as is: "Users can read own profile", "Clients can update own profile",
-- "Company admin can update client profiles", "Company admin can delete client profiles"

create policy "Staff can read profiles in own company" on public.profiles
  for select to authenticated
  using (company_id = public.get_my_company_id()
         and public.get_my_role() in ('company_admin', 'partner'));

create policy "Super admin can manage all profiles" on public.profiles
  for all to authenticated
  using (public.get_my_role() = 'super_admin')
  with check (public.get_my_role() = 'super_admin');

create policy "Staff can insert profiles in own company" on public.profiles
  for insert to authenticated
  with check (company_id = public.get_my_company_id()
              and public.get_my_role() in ('company_admin', 'partner'));

-- Extend the 24 Oct trigger: clients can't change their own PT flag or archive status
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() = 'super_admin' then return new; end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id then
    raise exception 'Not allowed to change role or company';
  end if;
  if public.get_my_role() = 'client'
     and (new.client_type is distinct from old.client_type
          or new.archived_at is distinct from old.archived_at) then
    raise exception 'Not allowed to change membership type or archive status';
  end if;
  return new;
end $$;

commit;
```

**Test (client):** client screen loads (name, goal, plan, diet). Profile → change age → *saved*.
**Test (coach + partner):** member list shows all members; open a client; archive / restore one test client.
**Test (super admin):** /admin → All Clients lists everyone; Edit company → Partner Logins → Remove a test partner → it disappears and stays gone after reload (this was silently failing before).

**Undo:**
```sql
begin;
drop policy "Staff can read profiles in own company" on public.profiles;
drop policy "Super admin can manage all profiles" on public.profiles;
drop policy "Staff can insert profiles in own company" on public.profiles;
create policy "Super admin can read all profiles" on public.profiles
  for select to public
  using ((public.get_my_role() = 'super_admin') or (id = auth.uid()) or (company_id = public.get_my_company_id()));
create policy "Users can read same company profiles" on public.profiles
  for select to public
  using ((id = auth.uid()) or (company_id = public.get_my_company_id()));
create policy "Company admin can insert profiles" on public.profiles
  for insert to public
  with check (company_id = (select p1.company_id from public.profiles p1 where p1.id = auth.uid()));
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() = 'super_admin' then return new; end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id then
    raise exception 'Not allowed to change role or company';
  end if;
  return new;
end $$;
commit;
```

---

## Step 4 — Logged-out visitors see only gym branding · ⚠️ removes 1 policy + 1 grant

Today anyone (even logged out) can read every company's full row: emails, phone, notes, trial and payment info. The login page only needs name / logo / banner / business type by slug. After this: logged-out visitors can read **only those columns**; logged-in users read only their own company (existing rule "Users can read own company"); super admin reads all (existing rule).

```sql
begin;

drop policy "Anyone can read company branding" on public.companies;

create policy "Public can read company branding" on public.companies
  for select to anon
  using (true);

revoke select on public.companies from anon;
grant select (name, slug, logo_url, banner_url, business_type) on public.companies to anon;

commit;
```

**Test (logged out / private tab):** open the login page using a gym's branded link (with its slug) → that gym's name/logo/banner show. Plain `/login` still works.
**Test (logged in, any role):** everything loads as before.

**Undo:**
```sql
begin;
drop policy "Public can read company branding" on public.companies;
create policy "Anyone can read company branding" on public.companies
  for select to public
  using (true);
grant select on public.companies to anon;
commit;
```

---

## Step 5 — Only staff can delete plans and feedback · ⚠️ removes 2 policies

Today the delete rules check the gym but not the role, so a client could delete plans or coach feedback in their gym.

```sql
begin;

drop policy "Company admin can delete weekly plans" on public.weekly_plans;
create policy "Staff can delete weekly plans" on public.weekly_plans
  for delete to authenticated
  using (public.get_my_role() in ('company_admin', 'partner')
         and client_id in (select id from public.profiles where company_id = public.get_my_company_id()));

drop policy "Company admin can delete session feedback" on public.session_feedback;
create policy "Staff can delete session feedback" on public.session_feedback
  for delete to authenticated
  using (public.get_my_role() in ('company_admin', 'partner')
         and session_id in (select ls.id from public.logged_sessions ls
                            join public.profiles p on p.id = ls.client_id
                            where p.company_id = public.get_my_company_id()));

commit;
```

**Test (coach):** delete a test plan → *Plan deleted*, and it stays gone after reload.

**Undo:**
```sql
begin;
drop policy "Staff can delete weekly plans" on public.weekly_plans;
create policy "Company admin can delete weekly plans" on public.weekly_plans
  for delete to public
  using (client_id in (select profiles.id from public.profiles where profiles.company_id = public.get_my_company_id()));
drop policy "Staff can delete session feedback" on public.session_feedback;
create policy "Company admin can delete session feedback" on public.session_feedback
  for delete to public
  using (session_id in (select ls.id from public.logged_sessions ls
                        join public.profiles p on p.id = ls.client_id
                        where p.company_id = public.get_my_company_id()));
commit;
```

---

## After all steps — confirm (read-only)

```sql
select tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public'
order by tablename, policyname;
```

## Known limits after this (not fixed here)

- A coach (and clients) can still read **their own** company row in full, including the super admin's internal `notes` field. Don't put sensitive notes there; moving notes to an admin-only table is a later fix.
- `client_goals` has RLS on with no rules, so nothing can read it from the browser. It isn't used by the app.
- Clients can still edit their own `diet_plan` / `trainer_name` text (low risk).
- RLS blocks don't raise errors on update/delete — they just affect 0 rows. Screens that matter check the result (`.select()` after update) and show a red message.

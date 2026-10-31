# Login branding through a function, not an open read rule (31 Oct 2026)

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Why.** The rule "Public can read company branding" on `companies` is `USING (true)` for `anon`:
any logged-out visitor can list every company. The anon column grant limits which columns they see,
but the rule is the only thing between anon and the table, so one wrong grant later would expose
emails, phones, limits and subscription state of every gym.

**Fix.** A `security definer` function `get_company_branding(p_slug)` returns only what the login
page shows (name, slug, logo, banner, business type, banner-has-branding switch) for **one** slug.
There is no colour column on `companies`; the login's colours come from `business_type`
(`lib/login-branding.ts`). The login page (`app/login/page.tsx`) calls it with `supabase.rpc` and
falls back to the old table read until Step 1 has run, so the order is: deploy the app, run Step 1,
test, then Step 2.

## Step 1 — add the function (nothing removed) — ✅ run on Mumbai 31 Oct 2026

Needs `db/2026-10-31-banner-branding.md` first (the `banner_has_branding` column).

```sql
create or replace function public.get_company_branding(p_slug text)
returns table (
  name text,
  slug text,
  logo_url text,
  banner_url text,
  business_type text,
  banner_has_branding boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select c.name, c.slug, c.logo_url, c.banner_url, c.business_type, c.banner_has_branding
  from public.companies c
  where c.slug = lower(trim(p_slug))
  limit 1;
$$;

revoke execute on function public.get_company_branding(text) from public;
grant execute on function public.get_company_branding(text) to anon, authenticated;

-- Check: one row for an existing slug, no rows for a made-up one
select * from public.get_company_branding('coach-srinig');
select * from public.get_company_branding('no-such-gym');
```

If `create function` complains about a type (e.g. `name` is `varchar`), cast in the select
(`c.name::text`) rather than changing the column.

## Test after Step 1

1. Phone, private tab: `coach-srinig.getcoachboard.com/login` and `getcoachboard.com/login/coach-srinig`
   → banner, logo and name as before.
2. Browser dev tools → Network: the page calls `rpc/get_company_branding`, not `companies?select=…`.
3. A made-up slug (`/login?company=no-such-gym`) shows the plain CoachBoard login.

## Step 2 — remove the open read rule — ✅ approved by Anand and run on Mumbai 31 Oct 2026

Checks passed: as anon, `select count(*) from companies` = 0; `get_company_branding('coach-srinig')`
returns Coach Srinivas. This removed one RLS policy (no data, no columns). After it,
logged-out visitors can't read `companies` at all; they only get the one-row result of the function.
Undo = recreate it: `create policy "Public can read company branding" on public.companies for select to anon using (true);`

```sql
drop policy "Public can read company branding" on public.companies;

-- Check: run as anon → 0 rows (not an error)
begin;
set local role anon;
select count(*) from public.companies;
rollback;
```

The old anon column grants on `companies` (`name, slug, logo_url, banner_url, business_type,
banner_has_branding`) become unused once the rule is gone (no rule = no rows), and are left in place.

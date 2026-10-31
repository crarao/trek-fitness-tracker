# Banner with the gym's own name and logo (31 Oct 2026)

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

Some gyms upload a finished banner design that already has their name, logo and slogan in it
(e.g. Coach Srinivas). Then the login's own name, tagline and logo on top repeat it, and cropping the
banner to fill the phone cuts its text off. New switch per company, set by super admin in
Companies → Edit → Logo & banner: **"Banner already shows the name and logo"**. When on (and a banner is
uploaded) the login shows the banner whole, uncropped, without the name / tagline / logo on top.

Adds one column (off by default, so nothing changes for existing gyms) and lets logged-out visitors
read it (the login page runs before login; same column grant as name, slug, logo, banner, business
type). Nothing is dropped or deleted. Owners can't change it: trigger `protect_company_columns` only
lets them change `logo_url` / `banner_url`.

## Step 1

```sql
alter table public.companies add column if not exists banner_has_branding boolean not null default false;

grant select (banner_has_branding) on public.companies to anon;

-- Check: expect one row, banner_has_branding false for every company
select name, slug, banner_has_branding from public.companies order by created_at;
```

The app works before and after this runs: until the column exists the switch is greyed out and the
login looks as before.

**Result 31 Oct:** run in Mumbai (`coachboard-mumbai`): column added, all 7 companies `false`. Switched on for Coach Srinivas from /admin (after reloading the page); the phone login shows the whole banner. Works.

## Test

1. `/admin` → Companies → Coach Srinivas → Edit → Logo & banner → tick **Banner already shows the name and
   logo**. The preview shows the whole banner without the name on top.
2. Phone, private tab: `coach-srinig.getcoachboard.com` → the same.
3. A gym with the switch off (e.g. Coach Rich) looks as before.

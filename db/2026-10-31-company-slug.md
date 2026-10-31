# Company slug: unique + format rule (31 Oct 2026)

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

The super admin now sets each company's **slug** (create form and edit panel in `/admin`). It is the short
name in the branded login link `getcoachboard.com/login/<slug>` and, later, the subdomain
`<slug>.getcoachboard.com`. Rules (same as `lib/company-slug.ts`): 3–30 characters, lowercase letters,
numbers and hyphens, starts with a letter, doesn't end with a hyphen, not one of
`www, app, admin, api, login, mail, support, help`.

The `slug` column already exists (it is in the logged-out column grant). Nothing in the app wrote it
before this change. This script only **adds** two guards. Nothing is dropped, deleted or changed:

- a **unique index**, so two companies can never share a slug, even if two saves happen at the same moment
  (the app checks first, and shows the same "already used" message if the index blocks a save)
- a **format check** for new and changed slugs (`NOT VALID`: old rows aren't checked, so it can't fail on them)

Empty slugs (`null`) are allowed, so companies made before slugs keep working.

## Step 0: check (read-only)

```sql
-- 1. Column type: expect one row, data_type text (or character varying)
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'companies' and column_name = 'slug';

-- 2. Slugs already filled in: expect 0 rows (none are in use)
select id, name, slug from public.companies where slug is not null order by created_at;
```

**If query 2 returns rows, stop and send a screenshot.** Duplicates would make Step 1 fail.

## Step 1: unique index + format check

```sql
create unique index if not exists companies_slug_key
  on public.companies (slug) where slug is not null;

alter table public.companies
  add constraint companies_slug_format check (
    slug is null or (
      slug ~ '^[a-z][a-z0-9-]{1,28}[a-z0-9]$'
      and slug not in ('www', 'app', 'admin', 'api', 'login', 'mail', 'support', 'help')
    )
  ) not valid;
```

**Result 31 Oct:** first run by mistake in the old **Tokyo** project (`rzndxzhmgxkxihnwqnoy`; found from the project id in its logs), harmless there. Then run in **Mumbai** (live): no duplicate slugs, unique index and format check added. The app's own check before saving worked throughout.

## Test

1. `/admin` → Add Company → type "Syed Fitness": the slug field fills in `syed-fitness`, and the preview reads
   `getcoachboard.com/login/syed-fitness`. Change it to `syedfitness`, create the company.
2. Add another company with slug `syedfitness` → red "already used by another company" under the field, nothing saved.
3. Try `ab`, `1fit`, `admin`, `fit-` → each shows its error, and Create stops.
4. Open `getcoachboard.com/login/syedfitness` in a private tab → the login page shows that company's name / logo.
5. Edit the company, change the slug → amber warning that the old link stops working. Save → the new link works.

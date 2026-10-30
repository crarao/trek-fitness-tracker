# 30 Oct 2026 — `company_type` on companies (Gym vs Individual coach, ROADMAP #60) — TO RUN BY ANAND

Adds one column, `'gym'` for every existing company (nothing changes until the super admin picks Individual coach).
Separate from `business_type` (kind of training) and from #42 (in-gym vs online mode).

No policy changes needed (checked against `db/2026-10-25-rls-remaining.md`):
- Super admin already updates every company row, and `protect_company_columns` lets super admin change any column.
- Company admin, partners and coaches already read their own company row ("members read their own company"),
  so they can read `company_type`. The trigger stops them changing it (they may only change logo / banner).
- Logged-out users can't read it (their column grant lists only name, slug, logo, banner, business type).

**Run this before deploying / testing** (step 2 is commented out: edit the slugs first, or set the type in the super admin UI instead):

```sql
-- 1. Add column
alter table public.companies
  add column if not exists company_type text not null default 'gym'
  check (company_type in ('gym', 'coach'));

-- 2. Optional backfill of existing solo-coach companies (edit the slugs first). The super admin
--    Edit → Company type dropdown does the same thing and is the preferred way.
-- update public.companies set company_type = 'coach' where slug in ('<coach-slug-1>', '<coach-slug-2>');

-- 3. Verify
select id, name, slug, company_type from public.companies order by created_at;
```

**Expected:** every row shows `gym` (or `coach` for the ones you changed).

Then: Super admin → Companies → Edit → Company type → Individual coach → Save Changes.

Before this runs: the super admin's Company type dropdown on Edit is greyed out ("Needs the company_type SQL first"),
creating an Individual coach company fails with a column error (creating a Gym still works), and every company behaves as a gym.

Undo — only with Anand's explicit approval (CLAUDE.md Rule #1): no undo SQL is written here. An undo would
remove the column; setting every company back to Gym does the same job without removing anything.

# 25 Oct 2026 — `is_test` on companies (super admin Dashboard)

Marks test companies so the super admin Dashboard and Clients tab leave them out.
Adds one column, `false` for every existing company. No policy changes: the super admin already
updates companies; coaches can't change it (trigger `protect_company_columns` limits them to logo / banner);
logged-out visitors can't read it (their column grant lists only name, slug, logo, banner, business type).

```sql
alter table public.companies add column if not exists is_test boolean not null default false;
```

Check:

```sql
select name, is_test from public.companies order by created_at desc;
```

Then: Super admin → Companies → Edit a test company → Test account: REAL → TEST → Save.
Before this runs, the Test account switch is greyed out and every company counts as real.

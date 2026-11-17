# One key per exercise name (17 Nov 2026)

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

## Why

FitLoft feedback (17 Nov): "Barbell", "Bar Bell" and "Barbel" became separate exercises. `exercises.name_key` is the name
with everything except letters and digits removed, in lower case ("Bar-Bell Squat" → `barbellsquat`). One key per gym
(and one in the shared starter list), so the same exercise can't be added twice under a different spelling. The app
uses the same rule: `nameKey()` in `lib/exercises.ts`. `exercise_logs.name_key` (5 Nov) is a different, older column
and stays as it is.

Additive only: a generated column and two indexes. No rows are changed.

## Step 1 — check first (expect 0 rows)

If this returns rows, two exercises in one gym (or in the starter list) have the same key: rename or archive one
before Step 2, or the unique index fails.

```sql
select company_id, lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g')) as k, count(*), string_agg(name, ' | ')
from public.exercises group by 1, 2 having count(*) > 1;
```

## Step 2 — column and indexes

`nulls not distinct`: the starter list (`company_id` null) counts as one group, so no `coalesce` is needed.

```sql
begin;
alter table public.exercises
  add column if not exists name_key text
  generated always as (lower(regexp_replace(name, '[^a-zA-Z0-9]', '', 'g'))) stored;
create unique index if not exists exercises_company_key_uniq
  on public.exercises (company_id, name_key) nulls not distinct;
create index if not exists exercises_aliases_gin
  on public.exercises using gin (aliases);
commit;
```

## Undo (only if Anand asks)

Removes only what Step 2 added. Commented out on purpose (Rule #1).

```sql
-- drop index if exists public.exercises_aliases_gin;
-- drop index if exists public.exercises_company_key_uniq;
-- alter table public.exercises drop column if exists name_key;
```

## Run log

- **Dev:** run 17 Nov 2026 by Anand. Step 1 returned 0 rows, Step 2 ran clean.
- **Mumbai:** not yet. Run Step 1 first, after Anand signs off the per-set build on the dev link.

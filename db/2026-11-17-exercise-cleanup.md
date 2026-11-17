# Exercise name cleanup: typed names → aliases (17 Nov 2026)

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

**Needs first:** `db/2026-11-17-exercises-name-key.md` (the `exercises.name_key` column) in the same project.

## Why

FitLoft feedback (17 Nov): "Barbell", "Bar Bell" and "Barbel" became separate lines in progress charts and reports.
Weights logged before the picker have a typed name and no `exercise_id`. Rather than editing those sessions, each
typed name becomes an **alias** of the right exercise. Reports already group a name with the exercise it is an alias of
(`progressKey` → `findExercise`), so the old sessions join that exercise's line. **Session data is never edited.**
Only `exercises.aliases` changes, and every change has an undo.

## Steps

1. **List** each gym's typed names that don't match any exercise (Step 1 below). The first query is to read; the
   second gives the same rows as one JSON cell for the script.
2. **Export the exercises** (Step 2) as one JSON cell.
3. **Suggestions CSV.** Save the two cells as `unmatched.json` and `exercises.json` (SQL Editor → the cell → Copy
   cell content), then run at the repo root:
   ```bash
   npx tsc scripts/exercise-cleanup.ts --outDir /tmp/ec --module commonjs --target es2020 --skipLibCheck
   node /tmp/ec/scripts/exercise-cleanup.js suggest unmatched.json exercises.json > exercise-cleanup.csv
   ```
   Columns: `company, typed_name, count, suggested_exercise_id, suggested_name`. The suggestion is `findExercise`
   (the app's rule: same key, alias, same words reordered, or a close spelling).
4. **Anand checks the CSV.** Fix wrong suggestions: put the right exercise's id and name, or **empty both** to skip
   the row. Save it as `exercise-cleanup-approved.csv`.
5. **Generate the SQL** from the approved CSV:
   ```bash
   node /tmp/ec/scripts/exercise-cleanup.js sql exercise-cleanup-approved.csv > exercise-aliases.sql
   ```
   One `update … array_append …` per row, plus the undo (commented). Run it in the SQL Editor (Step 3), then Step 1
   again: the fixed names are gone from the list.

Notes:
- The alias is the typed name in lower case (`'Barbel Squat'` → `'barbel squat'`), added only if it isn't there yet,
  so running the file twice changes nothing.
- When the suggestion is a **starter-list** exercise (`company_id` null), the alias helps every gym. That's fine for
  spellings, but skip gym-specific nicknames there (or add the gym's own exercise instead).
- Keep the CSV and the generated SQL outside the repo. They contain gym names.

## Step 1 — typed names that match no exercise

```sql
-- To read: each gym's logged names (no exercise_id) that match no name or alias, with how often they were logged
with logged as (
  select l.company_id, l.exercise_name as typed_name,
         lower(regexp_replace(l.exercise_name, '[^a-zA-Z0-9]', '', 'g')) as k, count(*) as n
  from public.exercise_logs l
  where l.exercise_id is null
  group by 1, 2, 3
)
select c.name as company, g.company_id, g.typed_name, g.n as count
from logged g
join public.companies c on c.id = g.company_id
where not exists (
  select 1 from public.exercises e
  where (e.company_id = g.company_id or e.company_id is null)
    and not e.is_archived
    and (e.name_key = g.k
         or exists (select 1 from unnest(e.aliases) a where lower(regexp_replace(a, '[^a-zA-Z0-9]', '', 'g')) = g.k))
)
order by c.name, g.n desc;
```

```sql
-- Same rows as one JSON cell → save as unmatched.json
with logged as (
  select l.company_id, l.exercise_name as typed_name,
         lower(regexp_replace(l.exercise_name, '[^a-zA-Z0-9]', '', 'g')) as k, count(*) as n
  from public.exercise_logs l
  where l.exercise_id is null
  group by 1, 2, 3
)
select json_agg(t) from (
  select c.name as company, g.company_id, g.typed_name, g.n as count
  from logged g
  join public.companies c on c.id = g.company_id
  where not exists (
    select 1 from public.exercises e
    where (e.company_id = g.company_id or e.company_id is null)
      and not e.is_archived
      and (e.name_key = g.k
           or exists (select 1 from unnest(e.aliases) a where lower(regexp_replace(a, '[^a-zA-Z0-9]', '', 'g')) = g.k))
  )
  order by c.name, g.n desc
) t;
```

## Step 2 — the exercise list as one JSON cell → save as exercises.json

```sql
select json_agg(t) from (
  select id, company_id, name, aliases, muscle_group, equipment, is_archived from public.exercises
) t;
```

## Step 3 — run the generated aliases SQL

Paste `exercise-aliases.sql` (from step 5) into the SQL Editor and run it. It is one transaction:

```sql
begin;
-- barbel squat → Barbell Squat
update public.exercises set aliases = array_append(aliases, 'barbel squat')
  where id = '<exercise id>' and not ('barbel squat' = any(aliases));
-- … one per approved row
commit;
```

## Undo

The generated file ends with the undo for exactly the aliases it added (commented out on purpose, Rule #1):

```sql
-- begin;
-- update public.exercises set aliases = array_remove(aliases, 'barbel squat') where id = '<exercise id>';
-- commit;
```

## Run log

- **Dev:** not yet (after the per-set build is on the dev link, on dev test data).
- **Mumbai:** not yet (after Anand signs off and the name_key SQL has run there). For FitLoft and the other gyms.

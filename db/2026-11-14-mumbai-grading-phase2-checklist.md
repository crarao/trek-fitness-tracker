# Mumbai catch-up: belt grading Phase 2 SQL (make prod = dev)

1. Run in: **Dev** — project `nnxrmaiinbmxfwzefbwx` — **already done** (11–12 Nov, by Anand). Nothing to run on dev.
2. Run in: **Mumbai (prod)** — project `nptxjfvkqjuekgkspemu` — https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new

**Before every Run: the address bar must show `nptxjfvkqjuekgkspemu`.** (Dev is `nnxrmaiinbmxfwzefbwx`.)

Anand runs this; Claude does not. Every file is additive: new nullable columns, one check rule, one trigger, two
functions, one new belt row per gym, three write rules narrowed in place. Nothing is dropped, deleted or renamed
(CLAUDE.md Rule #1). The live app (`main`) keeps working after each file, so run all three first, then merge.

## What differs between dev and prod today

Checked 14 Nov against `dev` @ 54592e9: every `db/*.md` file is on both projects (dev was copied from Mumbai on
10 Nov, and nothing in `db/` has been added since). The **only** schema differences are these three files, run on
dev and not yet on Mumbai:

| # | File | What it adds |
|---|---|---|
| 1 | `supabase/migrations/20261111120000_belt_grading_phase2.sql` | `grading_exam_candidates.removed_at` / `cancel_sent_at`, `student_grades.voided_at` / `voided_by`, `belt_ranks.dan` (+ check), trigger `grading_candidate_checks`, functions `save_grading_results` / `undo_grading_results` |
| 2 | `supabase/migrations/20261112120000_belt_grading_fee_brown1.sql` | `grading_exams.belt_fees` (+ check), Brown – 1st kyu (rank 8) for gyms whose ladder ends at Brown 2nd kyu |
| 3 | `supabase/migrations/20261112130000_belt_ranks_super_admin.sql` | `belt_ranks` insert / update / delete rules: super admin only (ALTER POLICY) |

**Order matters: 1 → 2 → 3.** File 2 needs file 1 first.

Data that differs **on purpose** (not part of this): on dev the QA Dojo has the belt ladder and Grading on (prod
QA Dojo has neither), and QA Solo's client limit is 2. Leave those as they are.

---

## Checklist

### A. Before you start

- [ ] Supabase → Mumbai project → **Database → Backups**: today's daily backup is listed. (Nothing here deletes,
      but this is the safety net.)
- [ ] Pick a quiet time (no one at DSSKA in the middle of a roll call). Each file runs in one transaction, in a second or two.
- [ ] Address bar shows `nptxjfvkqjuekgkspemu`.

### B. Step 0 — read-only checks (paste and run each; nothing changes)

```sql
-- a) Phase 1 tables are there                                         -- expect 4 rows
select table_name from information_schema.tables where table_schema = 'public'
  and table_name in ('belt_ranks', 'grading_exams', 'student_grades', 'grading_exam_candidates');
```
- [ ] 4 rows

```sql
-- b) Phase 2 has NOT run yet on Mumbai                                -- expect 0 rows
select table_name, column_name from information_schema.columns where table_schema = 'public'
  and column_name in ('removed_at', 'cancel_sent_at', 'voided_at', 'voided_by', 'dan', 'belt_fees')
  and table_name in ('grading_exam_candidates', 'student_grades', 'belt_ranks', 'grading_exams');
```
- [ ] 0 rows. **If any rows come back, stop** and tell Claude (part of it already ran).

```sql
-- c) no exams on prod yet (there is no exam screen on main)           -- expect 0
select count(*) from public.grading_exams;
```
- [ ] 0. **If not 0, stop** and tell Claude.

```sql
-- d) which gyms get Brown 1st kyu in file 2                           -- expect: DSSKA (one row)
select c.name, c.slug from public.belt_ranks r join public.companies c on c.id = r.company_id
where r.rank_order = 7 and r.belt_name = 'Brown' and r.kyu = 2
  and not exists (select 1 from public.belt_ranks x where x.company_id = r.company_id and x.rank_order = 8);
```
- [ ] One row: DSSKA. (No rows = DSSKA's ladder doesn't end at Brown 2nd kyu: file 2 then only adds the
      `belt_fees` column, which is fine. Note it for Claude.)

```sql
-- e) DSSKA's ladder now (keep this result to compare after file 2)
select c.name, r.rank_order, r.belt_name, r.kyu, r.color_hex, r.min_months_from_previous, r.is_active
from public.belt_ranks r join public.companies c on c.id = r.company_id
where c.grading_enabled order by c.name, r.rank_order;
```
- [ ] Saved the result (screenshot is fine).

### C. File 1 — Phase 2

- [ ] Open `supabase/migrations/20261111120000_belt_grading_phase2.sql` on GitHub (`dev` branch) → Raw → copy all.
- [ ] Paste the **whole file** into the Mumbai SQL Editor and Run. (The header and the checks are comments; only
      the part between `begin;` and `commit;` runs.) Expect "Success. No rows returned".
- [ ] Checks:

```sql
-- a) the 5 new columns                                                 -- expect 5 rows
select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'
  and column_name in ('removed_at', 'cancel_sent_at', 'voided_at', 'voided_by', 'dan')
  and table_name in ('grading_exam_candidates', 'student_grades', 'belt_ranks') order by 1, 2;

-- b) trigger on candidates                                             -- expect 1 row: grading_candidate_checks
select tgname from pg_trigger where tgrelid = 'public.grading_exam_candidates'::regclass and not tgisinternal;

-- c) the two functions, authenticated only                            -- expect 2 rows: authenticated true, anon false
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('anon', p.oid, 'execute') as anon
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('save_grading_results', 'undo_grading_results');

-- d) a call without a login is refused                                -- expect {"ok": false, "error": "not_found"}
select public.save_grading_results(gen_random_uuid());
```
- [ ] a 5 rows · b 1 row · c true / false twice · d `not_found`

### D. File 2 — fees per belt + Brown 1st kyu

- [ ] Copy all of `supabase/migrations/20261112120000_belt_grading_fee_brown1.sql` (Raw), paste, Run.
- [ ] Checks:

```sql
-- a) the new column                                                    -- expect 1 row: jsonb
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'grading_exams' and column_name = 'belt_fees';

-- b) DSSKA's ladder ends Brown 2nd kyu (7), Brown 1st kyu (8)         -- compare with Step 0 e: one row more
select c.name, r.rank_order, r.belt_name, r.kyu, r.min_months_from_previous
from public.belt_ranks r join public.companies c on c.id = r.company_id
where c.grading_enabled order by c.name, r.rank_order;
```
- [ ] a jsonb · b same rows as Step 0 e plus `8 Brown 1 (6 months)`

### E. File 3 — belts: super admin only

- [ ] Copy all of `supabase/migrations/20261112130000_belt_ranks_super_admin.sql` (Raw), paste, Run.
- [ ] Check:

```sql
-- expect 4 rows: select = super_admin OR the gym (unchanged); insert / update / delete = super_admin only
select policyname, cmd, qual, with_check from pg_policies
where schemaname = 'public' and tablename = 'belt_ranks' order by cmd;
```
- [ ] select unchanged · insert / update / delete mention only `super_admin`

### F. Prove dev = prod (run on BOTH projects, compare)

Run this once in the **Mumbai** SQL Editor and once in the **Dev** SQL Editor
(https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new). Read-only. It gives one short fingerprint per
part of the schema; the two results should be identical, line for line.

```sql
select 'columns' as part, count(*) as n, md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, ''), ',' order by table_name, column_name)) as fingerprint
  from information_schema.columns where table_schema = 'public'
union all
select 'policies', count(*), md5(string_agg(tablename || '.' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ',' order by tablename, policyname))
  from pg_policies where schemaname = 'public'
union all
select 'functions', count(*), md5(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || md5(p.prosrc), ',' order by p.proname, pg_get_function_identity_arguments(p.oid)))
  from pg_proc p where p.pronamespace = 'public'::regnamespace
union all
select 'triggers', count(*), md5(string_agg(c.relname || '.' || t.tgname, ',' order by c.relname, t.tgname))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and not t.tgisinternal
union all
select 'constraints', count(*), md5(string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname))
  from pg_constraint where connamespace = 'public'::regnamespace
order by 1;
```
- [ ] All 5 lines identical on both projects → **dev and prod schemas are equal.**
- [ ] A line differs → copy both results to Claude; it will list exactly what's different (read-only queries).

### G. After the SQL

- [ ] Tell Claude it's done (and any check that looked different). Claude then updates, on `dev`: the Status line in
      each of the three files ("RUN ON MUMBAI <date>"), CLAUDE.md (the "not yet on Mumbai" notes), ROADMAP #79.
- [ ] Super Admin → Companies → DSSKA → Edit → **Belt grading**: the ladder shows Brown – 1st kyu last; Grading is on.
- [ ] **Anand:** merge `dev` into `main` (Claude never does this). The smoke tests run on the Production deploy.
- [ ] On the live app as DSSKA owner: `/company` opens the new dojo home; ⋯ → Grading exams opens; schedule a
      test exam only if you want one on real data (it can be cancelled, never deleted).

### If something goes wrong

Each file is one transaction: if it errors, **nothing** from that file was saved. Copy the error to Claude and stop
there (don't run the next file). Don't try to undo anything by hand: there are no undo scripts on purpose (Rule #1).

---
Status: written 14 Nov 2026. Mumbai: **not run yet**.

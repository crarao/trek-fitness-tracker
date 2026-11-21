# 21 Nov 2026 — Yoga demo slice: activity categories + the yoga starter list — NOT RUN YET

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> (Only when Anand says yoga goes to prod, and only after R31–R44 pass on dev. Step 1 only on Mumbai; Step 2 there
> only with a real studio's slug.)
>
> Check the project ref in the address bar before running.

**Anand runs this; Claude does not.** Additions only (CLAUDE.md Rule #1): one new nullable column. No `DROP`,
`DELETE`, `TRUNCATE`, no changed rules, triggers or existing rows. Needs `dojo_activities`
(`db/2026-11-19-dojo-activities-absences.md`, run on dev 19 Nov and Mumbai 21 Nov).

**Order:** Step 1 (column) → `scripts/seed-yoga-demo.ts` (dev only, creates the QA yoga companies and their
activity list) → Step 3 (checks). Step 2 is the same yoga list for a real studio, by slug, when one signs up.

## What it does

- `dojo_activities.category` (text, null = no category, max 40 characters). Yoga studios group their list as
  Asana / Pranayama / Meditation / Yoga Nidra on the activities page and the roll call (`groupByCategory` in
  `lib/dojo-activities.ts`). A list with no categories (DSSKA, QA Dojo) shows exactly as before.
- The existing rules (`iso dojo_activities …`) and grants are per table, so they cover the new column: nothing
  else to change. The app reads activities with `select('*')`, so it works before and after this step.

## Step 1 — the column

```sql
alter table public.dojo_activities
  add column if not exists category text
  check (category is null or length(btrim(category)) between 1 and 40);
```

## Step 2 — yoga starter list for a studio (by slug)

Not needed for the QA yoga companies on dev (the seed script adds the same list). For a real studio: put its slug
in the first line. Re-running adds nothing twice (`on conflict do nothing`, the unique name index).
Keep in step with `YOGA_STARTER_ACTIVITIES` in `lib/dojo-activities.ts`.

```sql
with c as (select id from public.companies where slug = 'qayogastudio' and business_type = 'yoga')   -- the studio's slug
insert into public.dojo_activities (company_id, name, description, sort_order, is_default, category)
select c.id, v.name, v.description, v.sort_order, v.is_default, v.category
from c, (values
  ('Surya Namaskar',          'Sun salutation rounds',                          1, true,  'Asana'),
  ('Standing poses',          'Tadasana, Trikonasana, Virabhadrasana',          2, false, 'Asana'),
  ('Balancing poses',         'Vrikshasana, Garudasana',                        3, false, 'Asana'),
  ('Seated & forward bends',  'Paschimottanasana, Baddha Konasana',             4, false, 'Asana'),
  ('Backbends',               'Bhujangasana, Dhanurasana, Ustrasana',           5, false, 'Asana'),
  ('Inversions',              'Sarvangasana, Halasana',                         6, false, 'Asana'),
  ('Anulom Vilom',            'Alternate nostril breathing',                    7, false, 'Pranayama'),
  ('Kapalbhati',              'Skull-shining breath',                           8, false, 'Pranayama'),
  ('Bhastrika',               'Bellows breath',                                 9, false, 'Pranayama'),
  ('Bhramari',                'Humming bee breath',                            10, false, 'Pranayama'),
  ('Ujjayi',                  'Ocean breath',                                  11, false, 'Pranayama'),
  ('Breath awareness',        null,                                            12, false, 'Meditation'),
  ('Om chanting',             null,                                            13, false, 'Meditation'),
  ('Trataka',                 'Candle gazing',                                 14, false, 'Meditation'),
  ('Guided meditation',       null,                                            15, false, 'Meditation'),
  ('Shavasana',               'Final relaxation',                              16, true,  'Yoga Nidra'),
  ('Body scan',               null,                                            17, false, 'Yoga Nidra'),
  ('Sankalpa',                'Resolve',                                       18, false, 'Yoga Nidra'),
  ('Guided Yoga Nidra',       null,                                            19, false, 'Yoga Nidra')
) as v(name, description, sort_order, is_default, category)
on conflict do nothing;
```

## Step 3 — checks (read-only)

```sql
-- a) the column exists, nullable
select column_name, data_type, is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'dojo_activities' and column_name = 'category';   -- 1 row, YES

-- b) dojos untouched: every existing dojo activity still has no category
select c.slug, count(*) as activities, count(a.category) as with_category
from public.dojo_activities a join public.companies c on c.id = a.company_id
group by c.slug order by c.slug;   -- qadojo (dev) / dsska (prod): with_category = 0

-- c) after the seed script (dev): the yoga lists
select c.slug, a.category, count(*) from public.dojo_activities a join public.companies c on c.id = a.company_id
where c.business_type = 'yoga' group by 1, 2 order by 1, 2;   -- per slug: Asana 6, Meditation 4, Pranayama 5, Yoga Nidra 4
```

## Run log

- Dev: not run yet
- Mumbai: not run

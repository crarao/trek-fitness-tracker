# 20 Nov 2026 — Dojo activity items by belt (categories with belt-tagged items) — NOT RUN YET

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`** (Step 1 and Step 3 only;
> DSSKA's own items come later from the sensei's reply, see Step 2)
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

**Anand runs this; Claude does not.** Additions only (CLAUDE.md Rule #1): two new columns, one trigger, seed rows. No
`DROP`, `DELETE`, `TRUNCATE` or dropped columns. Needs `db/2026-11-19-dojo-activities-absences.md` (dojo_activities)
and belt grading (`belt_ranks`).

**Order:** Step 1 (columns + guard) → Step 2 (QA Dojo draft list, **dev only**) → Step 3 (checks).

## What it does

Decided 20 Nov: the 13 generic activities stay as **categories**; under some of them the dojo adds specific
**items** (katas, kicks, kumite drills, weapons forms), each with the belt where it is **first taught**. Higher belts
keep practising it, so an item counts for a student present in the class whose belt (on the class date) is that belt
or higher. Ticking only the category still means "everyone did it" (as before).

New columns on **`dojo_activities`** (existing rows unchanged: both null = a category, for everyone):
- `parent_id` — the category this item belongs to (null = a category). Two levels only.
- `min_rank_id` — the belt where the item is first taught (null = every belt).

Trigger `dojo_activity_tree_checks` (before insert / update): the category must be in the same gym and be a category
itself (no items under items), an activity that has items can't be moved under another, and the belt must be the
gym's own. The existing four rules and the active rule already cover the new columns (owner / partner write, the
whole gym reads); no new grants.

## Step 1 — columns and guard

```sql
begin;

alter table public.dojo_activities
  add column if not exists parent_id   uuid references public.dojo_activities(id) on delete cascade,
  add column if not exists min_rank_id uuid references public.belt_ranks(id) on delete set null;

create index if not exists dojo_activities_parent_idx on public.dojo_activities (parent_id);

create or replace function public.dojo_activity_tree_checks()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p record;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'An activity can''t be its own category'; end if;
    select company_id, parent_id into p from dojo_activities where id = new.parent_id;
    if not found or p.company_id is distinct from new.company_id then
      raise exception 'The category must be one of this gym''s activities';
    end if;
    if p.parent_id is not null then raise exception 'Items can''t have items of their own'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from dojo_activities c where c.parent_id = new.id) then
      raise exception 'This activity has items, so it can''t go under another one';
    end if;
  end if;
  if new.min_rank_id is not null
     and not exists (select 1 from belt_ranks r where r.id = new.min_rank_id and r.company_id = new.company_id) then
    raise exception 'The belt must be one of this gym''s belts';
  end if;
  return new;
end $$;

create or replace trigger dojo_activity_tree_checks before insert or update on public.dojo_activities
  for each row execute function public.dojo_activity_tree_checks();

commit;
```

## Step 2 — QA Dojo draft list (DEV ONLY)

The standard Shotokan kyu syllabus sent to DSSKA's sensei on 20 Nov (items 3–37 of that message), seeded under QA
Dojo's categories with QA Dojo's own belts. **Run on Dev only.** DSSKA (Mumbai) gets its list after the sensei
replies (a separate file). Re-running adds nothing twice (`on conflict do nothing`, names are unique per gym).
Weapons items start with no belt (everyone) until the sensei says.

```sql
with c as (select id from public.companies where slug = 'qadojo'),
belt as (
  -- 'White' = the lowest belt without a kyu; others by kyu number
  select r.id, coalesce(r.kyu::text, 'White') as k
  from public.belt_ranks r, c where r.company_id = c.id and r.dan is null
),
cat as (select a.id, a.name from public.dojo_activities a, c where a.company_id = c.id and a.parent_id is null)
insert into public.dojo_activities (company_id, parent_id, name, min_rank_id, sort_order, is_default)
select c.id, cat.id, v.name, belt.id, v.ord, false
from c, (values
  ('Basics', 'Zenkutsu-dachi', 'White', 1), ('Basics', 'Oi-zuki', 'White', 2), ('Basics', 'Age-uke', 'White', 3),
  ('Basics', 'Gedan-barai', 'White', 4), ('Basics', 'Soto-uke', 'White', 5), ('Basics', 'Gyaku-zuki', '8', 6),
  ('Basics', 'Uchi-uke', '8', 7), ('Basics', 'Kokutsu-dachi + Shuto-uke', '8', 8), ('Basics', 'Kiba-dachi', '7', 9),
  ('Basics', 'Combination techniques', '6', 10),
  ('Kicks', 'Mae-geri', 'White', 1), ('Kicks', 'Yoko-geri keage', '7', 2), ('Kicks', 'Yoko-geri kekomi', '7', 3),
  ('Kicks', 'Mawashi-geri', '6', 4), ('Kicks', 'Ushiro-geri', '5', 5),
  ('Higher kicks', 'Jodan mawashi-geri', '4', 1), ('Higher kicks', 'Ura-mawashi-geri', '3', 2), ('Higher kicks', 'Jumping kicks', '3', 3),
  ('Kata practice', 'Heian Shodan', 'White', 1), ('Kata practice', 'Heian Nidan', '8', 2), ('Kata practice', 'Heian Sandan', '7', 3),
  ('Kata practice', 'Heian Yondan', '6', 4), ('Kata practice', 'Heian Godan', '5', 5), ('Kata practice', 'Tekki Shodan', '4', 6),
  ('Kata practice', 'Bassai Dai', '3', 7), ('Kata practice', 'Kanku Dai', '2', 8), ('Kata practice', 'Jion', '2', 9),
  ('Kata practice', 'Enpi', '2', 10),
  ('Kumite practice', 'Gohon kumite (5-step)', 'White', 1), ('Kumite practice', 'Sanbon kumite (3-step)', '7', 2),
  ('Kumite practice', 'Kihon ippon kumite (1-step)', '5', 3),
  ('Kumite higher techniques', 'Jiyu ippon kumite (semi-free)', '3', 1), ('Kumite higher techniques', 'Jiyu kumite (free sparring)', '1', 2),
  ('Weapon training', 'Nunchaku basics', null, 1), ('Weapon training', 'Sword basics', null, 2)
) as v(category, name, belt_key, ord)
join cat on cat.name = v.category
left join belt on belt.k = v.belt_key
on conflict do nothing;

-- 35 rows; every item has its category, and a belt except the 2 weapons items
select p.name as category, a.name as item, r.belt_name, r.kyu
from public.dojo_activities a
join public.dojo_activities p on p.id = a.parent_id
left join public.belt_ranks r on r.id = a.min_rank_id
where a.company_id = (select id from public.companies where slug = 'qadojo')
order by p.sort_order, a.sort_order;
```

If the `select` returns fewer than 35 rows: a category name differs (check `/company/activities` on QA Dojo) or QA
Dojo has no belt ladder on this database (an item with an unknown belt is still added, with no belt = everyone).

## Step 3 — checks

```sql
-- a) the two columns
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'dojo_activities' and column_name in ('parent_id', 'min_rank_id');  -- 2 rows

-- b) the trigger
select tgname from pg_trigger where tgname = 'dojo_activity_tree_checks';                                          -- 1 row

-- c) rules unchanged: still five on dojo_activities (four + active)
select count(*) from pg_policies where schemaname = 'public' and tablename = 'dojo_activities';                     -- 5
```

## Before this runs

The app works exactly as after the 19 Nov file: pages read `dojo_activities` with `*` and only show categories /
items once `parent_id` is on the rows; before that there are no "+ Add item" buttons and the checklist is flat.

## Undo

No undo SQL is written here (CLAUDE.md Rule #1). An undo would drop the two columns and the trigger, **only with
Anand's explicit approval**.

## Run log

- Dev: not run yet
- Mumbai: not run yet

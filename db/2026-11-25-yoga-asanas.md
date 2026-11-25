# Yoga asanas for a yoga company (25 Nov 2026, Sanskrit names)

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

**Status: see Run log at the end.** Anand runs this; Claude does not.

## What it does

Adds 42 asanas, pranayama and relaxation items to **one company's own exercise list** (`exercises.company_id`
= that company), not to the shared starter list. Names are the Sanskrit asana names as written in India
("Vrikshasana", "Shavasana"); the English names go in `aliases`, so a coach can search "tree pose" or
"vrikshasana". The AI plan writes Sanskrit names too (`app/api/generate-plan/route.ts`), so they link on Assign.

A yoga company sees only its own exercises plus Surya Namaskar from the starter list (`shownForBusiness` in
`lib/exercises.ts`), so this list includes Sanskrit versions of the starter list's yoga items (Balasana,
Adho Mukha Svanasana, Marjaryasana-Bitilasana, Paschimottanasana, Eka Pada Rajakapotasana, Phalakasana,
Vasisthasana).

- No deletes. Step 2 only renames rows added by the first (English) version of this file; Step 3 only adds
  rows (`on conflict do nothing`), so both are safe to run again.
- Removing one later = Archive on the Exercise list page (never delete).
- Plans saved before the rename keep the old name as typed (a plan stores a copy of the name).

**Before running:** put the company's slug in place of `pranayoga` (one place in each step).

## Step 1 — check the company

```sql
select id, name, slug, business_type, company_type from public.companies where slug = 'pranayoga';
-- expect 1 row: business_type yoga
```

## Step 2 — only if the English version was run: rename to Sanskrit

Dev ran the English version on 25 Nov. On a company that never had it, both updates change 0 rows (fine to skip).

```sql
update public.exercises e
set name = v.new_name, aliases = v.aliases::text[]
from public.companies c,
(values
  ('Mountain Pose', 'Tadasana', '{mountain pose,samasthiti}'),
  ('Tree Pose', 'Vrikshasana', '{tree pose,vriksasana,vrksasana}'),
  ('Warrior I', 'Virabhadrasana I', '{warrior i,warrior 1,virabhadrasana 1}'),
  ('Warrior II', 'Virabhadrasana II', '{warrior ii,warrior 2,virabhadrasana 2}'),
  ('Triangle Pose', 'Trikonasana', '{triangle pose,utthita trikonasana}'),
  ('Extended Side Angle', 'Parsvakonasana', '{extended side angle,side angle pose,utthita parsvakonasana}'),
  ('Chair Pose', 'Utkatasana', '{chair pose}'),
  ('Standing Forward Bend', 'Uttanasana', '{standing forward bend,forward fold}'),
  ('Low Lunge', 'Anjaneyasana', '{low lunge,crescent lunge}'),
  ('Garland Pose', 'Malasana', '{garland pose,yogi squat}'),
  ('Cobra Pose', 'Bhujangasana', '{cobra pose,cobra}'),
  ('Sphinx Pose', 'Salamba Bhujangasana', '{sphinx pose,sphinx}'),
  ('Locust Pose', 'Shalabhasana', '{locust pose,salabhasana}'),
  ('Bow Pose', 'Dhanurasana', '{bow pose}'),
  ('Bridge Pose', 'Setu Bandhasana', '{bridge pose,setu bandha sarvangasana}'),
  ('Camel Pose', 'Ustrasana', '{camel pose}'),
  ('Boat Pose', 'Navasana', '{boat pose,paripurna navasana}'),
  ('Butterfly Pose', 'Baddha Konasana', '{butterfly pose,bound angle pose,titli asana}'),
  ('Seated Twist', 'Ardha Matsyendrasana', '{seated twist,half lord of the fishes}'),
  ('Easy Pose', 'Sukhasana', '{easy pose,cross legged sitting}'),
  ('Supine Twist', 'Supta Matsyendrasana', '{supine twist,reclined twist}'),
  ('Happy Baby', 'Ananda Balasana', '{happy baby,happy baby pose}'),
  ('Legs Up the Wall', 'Viparita Karani', '{legs up the wall}'),
  ('Fish Pose', 'Matsyasana', '{fish pose}'),
  ('Shoulder Stand', 'Sarvangasana', '{shoulder stand,salamba sarvangasana}'),
  ('Plough Pose', 'Halasana', '{plough pose,plow pose}'),
  ('Corpse Pose', 'Shavasana', '{corpse pose,savasana,relaxation pose}'),
  ('Ujjayi Breathing', 'Ujjayi Pranayama', '{ujjayi,ujjayi breathing,ocean breath}'),
  ('Sheetali Breathing', 'Sheetali Pranayama', '{sheetali,shitali,sheetali breathing,cooling breath}'),
  ('Meditation', 'Dhyana', '{meditation,guided meditation}')
) as v(old_name, new_name, aliases)
where c.slug = 'pranayoga' and e.company_id = c.id and e.name = v.old_name;
-- expect "UPDATE 30" on dev (0 elsewhere)

update public.exercises e
set aliases = v.aliases::text[]
from public.companies c,
(values
  ('Kapalbhati', '{kapalbhati pranayama,skull shining breath}'),
  ('Bhramari', '{bhramari pranayama,humming bee breath}'),
  ('Bhastrika', '{bhastrika pranayama,bellows breath}'),
  ('Nadi Shodhana', '{nadi shodhana pranayama,alternate nostril breathing}'),
  ('Yoga Nidra', '{guided relaxation,yogic sleep}')
) as v(name, aliases)
where c.slug = 'pranayoga' and e.company_id = c.id and e.name = v.name;
-- expect "UPDATE 5" on dev (0 elsewhere)
```

## Step 3 — add the asanas

```sql
insert into public.exercises (company_id, name, muscle_group, equipment, aliases, created_by)
select c.id, v.name, v.muscle_group, 'bodyweight', v.aliases::text[], null
from public.companies c
cross join (values
  ('Tadasana',                 'full_body', '{mountain pose,samasthiti}'),
  ('Vrikshasana',              'legs',      '{tree pose,vriksasana,vrksasana}'),
  ('Virabhadrasana I',         'legs',      '{warrior i,warrior 1,virabhadrasana 1}'),
  ('Virabhadrasana II',        'legs',      '{warrior ii,warrior 2,virabhadrasana 2}'),
  ('Trikonasana',              'mobility',  '{triangle pose,utthita trikonasana}'),
  ('Parsvakonasana',           'legs',      '{extended side angle,side angle pose,utthita parsvakonasana}'),
  ('Utkatasana',               'legs',      '{chair pose}'),
  ('Uttanasana',               'mobility',  '{standing forward bend,forward fold}'),
  ('Anjaneyasana',             'mobility',  '{low lunge,crescent lunge}'),
  ('Malasana',                 'mobility',  '{garland pose,yogi squat}'),
  ('Bhujangasana',             'back',      '{cobra pose,cobra}'),
  ('Salamba Bhujangasana',     'back',      '{sphinx pose,sphinx}'),
  ('Shalabhasana',             'back',      '{locust pose,salabhasana}'),
  ('Dhanurasana',              'back',      '{bow pose}'),
  ('Setu Bandhasana',          'back',      '{bridge pose,setu bandha sarvangasana}'),
  ('Ustrasana',                'back',      '{camel pose}'),
  ('Navasana',                 'core',      '{boat pose,paripurna navasana}'),
  ('Baddha Konasana',          'mobility',  '{butterfly pose,bound angle pose,titli asana}'),
  ('Ardha Matsyendrasana',     'mobility',  '{seated twist,half lord of the fishes}'),
  ('Sukhasana',                'mobility',  '{easy pose,cross legged sitting}'),
  ('Supta Matsyendrasana',     'mobility',  '{supine twist,reclined twist}'),
  ('Ananda Balasana',          'mobility',  '{happy baby,happy baby pose}'),
  ('Viparita Karani',          'mobility',  '{legs up the wall}'),
  ('Matsyasana',               'mobility',  '{fish pose}'),
  ('Sarvangasana',             'full_body', '{shoulder stand,salamba sarvangasana}'),
  ('Halasana',                 'mobility',  '{plough pose,plow pose}'),
  ('Shavasana',                'mobility',  '{corpse pose,savasana,relaxation pose}'),
  ('Kapalbhati',               'mobility',  '{kapalbhati pranayama,skull shining breath}'),
  ('Bhramari',                 'mobility',  '{bhramari pranayama,humming bee breath}'),
  ('Bhastrika',                'mobility',  '{bhastrika pranayama,bellows breath}'),
  ('Nadi Shodhana',            'mobility',  '{nadi shodhana pranayama,alternate nostril breathing}'),
  ('Ujjayi Pranayama',         'mobility',  '{ujjayi,ujjayi breathing,ocean breath}'),
  ('Sheetali Pranayama',       'mobility',  '{sheetali,shitali,sheetali breathing,cooling breath}'),
  ('Yoga Nidra',               'mobility',  '{guided relaxation,yogic sleep}'),
  ('Dhyana',                   'mobility',  '{meditation,guided meditation}'),
  ('Balasana',                 'mobility',  '{child''s pose,childs pose,child pose}'),
  ('Adho Mukha Svanasana',     'mobility',  '{downward dog,downward facing dog,down dog}'),
  ('Marjaryasana-Bitilasana',  'mobility',  '{cat cow,cat-cow stretch,marjaryasana,bitilasana}'),
  ('Paschimottanasana',        'mobility',  '{seated forward bend}'),
  ('Eka Pada Rajakapotasana',  'mobility',  '{pigeon pose,kapotasana}'),
  ('Phalakasana',              'core',      '{plank pose,high plank}'),
  ('Vasisthasana',             'core',      '{side plank pose}')
) as v(name, muscle_group, aliases)
where c.slug = 'pranayoga'
on conflict do nothing;
-- expect "INSERT 0 42" on a new company, "INSERT 0 7" on dev after Step 2 (0 = wrong slug, or already added)
```

## Step 4 — check

```sql
select e.name, e.aliases from public.exercises e
join public.companies c on c.id = e.company_id
where c.slug = 'pranayoga' and not e.is_archived
order by e.name;
-- expect 42 rows, all Sanskrit names (more if the coach added their own)
```

Then on the dev link: the yoga coach → a client → Plans → New plan → pick an exercise → search "tree pose":
**Vrikshasana** should come up.

## Run log

- Dev: English version (35 rows) run by Anand 25 Nov. Sanskrit rename + additions: not run yet.
- Mumbai: not run yet.

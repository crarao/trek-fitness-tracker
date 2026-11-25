# Yoga asanas for the yoga demo company (25 Nov 2026)

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. After testing on the dev link, run in: Mumbai (prod) — project `nptxjfvkqjuekgkspemu`**
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
>
> Check the project ref in the address bar before running.

**Status: not run yet.** Anand runs this; Claude does not.

## What it does

Adds 35 yoga poses, breathing practices and relaxation items to **one company's own exercise list**
(`exercises.company_id` = that company), not to the shared starter list, so gyms don't see them in their picker.
The Sanskrit names go in `aliases`, so a coach can search "vrikshasana" or "tree pose", and the AI plan's English
names ("Tree Pose", "Warrior II") link to these on Assign.

- **Only adds rows.** No update, no delete. `on conflict do nothing`: a name the company already has is skipped, so
  running it twice is safe.
- Left out because the starter list already has them: Surya Namaskar, Cat-Cow Stretch, Child's Pose, Downward Dog,
  Pigeon Stretch, Hamstring Stretch (alias Paschimottanasana), Deep Breathing (aliases Pranayama, Anulom Vilom),
  Plank, Side Plank, Glute Bridge.
- Removing one later = Archive on the Exercise list page (never delete).

**Before running:** create the demo company in Super Admin first (Company type Individual coach, Business type
Yoga) and put its slug in **both** places marked `pranayoga` below. Change nothing else.

## Step 1 — check the company

```sql
select id, name, slug, business_type, company_type from public.companies where slug = 'pranayoga';
-- expect 1 row: business_type yoga, company_type coach
```

## Step 2 — add the asanas

```sql
insert into public.exercises (company_id, name, muscle_group, equipment, aliases, created_by)
select c.id, v.name, v.muscle_group, 'bodyweight', v.aliases::text[], null
from public.companies c
cross join (values
  -- Standing
  ('Mountain Pose',          'full_body', '{tadasana,samasthiti}'),
  ('Tree Pose',              'legs',      '{vrikshasana,vriksasana}'),
  ('Warrior I',              'legs',      '{virabhadrasana 1,virabhadrasana i,warrior 1}'),
  ('Warrior II',             'legs',      '{virabhadrasana 2,virabhadrasana ii,warrior 2}'),
  ('Triangle Pose',          'mobility',  '{trikonasana,utthita trikonasana}'),
  ('Extended Side Angle',    'legs',      '{utthita parsvakonasana,side angle pose}'),
  ('Chair Pose',             'legs',      '{utkatasana}'),
  ('Standing Forward Bend',  'mobility',  '{uttanasana,forward fold}'),
  ('Low Lunge',              'mobility',  '{anjaneyasana,crescent lunge}'),
  ('Garland Pose',           'mobility',  '{malasana,yogi squat}'),
  -- On the belly / back bends
  ('Cobra Pose',             'back',      '{bhujangasana}'),
  ('Sphinx Pose',            'back',      '{salamba bhujangasana}'),
  ('Locust Pose',            'back',      '{shalabhasana,salabhasana}'),
  ('Bow Pose',               'back',      '{dhanurasana}'),
  ('Bridge Pose',            'back',      '{setu bandhasana,setu bandha sarvangasana}'),
  ('Camel Pose',             'back',      '{ustrasana}'),
  -- Seated / core / twists
  ('Boat Pose',              'core',      '{navasana,paripurna navasana}'),
  ('Butterfly Pose',         'mobility',  '{baddha konasana,bound angle pose}'),
  ('Seated Twist',           'mobility',  '{ardha matsyendrasana,half lord of the fishes}'),
  ('Easy Pose',              'mobility',  '{sukhasana,cross legged sitting}'),
  -- Lying down / inversions
  ('Supine Twist',           'mobility',  '{supta matsyendrasana,reclined twist}'),
  ('Happy Baby',             'mobility',  '{ananda balasana}'),
  ('Legs Up the Wall',       'mobility',  '{viparita karani}'),
  ('Fish Pose',              'mobility',  '{matsyasana}'),
  ('Shoulder Stand',         'full_body', '{sarvangasana,salamba sarvangasana}'),
  ('Plough Pose',            'mobility',  '{halasana,plow pose}'),
  ('Corpse Pose',            'mobility',  '{savasana,shavasana,relaxation pose}'),
  -- Breathing (pranayama)
  ('Kapalbhati',             'mobility',  '{kapalbhati pranayama,skull shining breath}'),
  ('Bhramari',               'mobility',  '{bhramari pranayama,humming bee breath}'),
  ('Bhastrika',              'mobility',  '{bhastrika pranayama,bellows breath}'),
  ('Nadi Shodhana',          'mobility',  '{nadi shodhana pranayama,alternate nostril breathing}'),
  ('Ujjayi Breathing',       'mobility',  '{ujjayi,ocean breath,ujjayi pranayama}'),
  ('Sheetali Breathing',     'mobility',  '{sheetali,shitali,cooling breath}'),
  -- Relaxation
  ('Yoga Nidra',             'mobility',  '{guided relaxation,yogic sleep}'),
  ('Meditation',             'mobility',  '{dhyana,guided meditation}')
) as v(name, muscle_group, aliases)
where c.slug = 'pranayoga'
on conflict do nothing;
-- expect "INSERT 0 35" the first time (0 = wrong slug, or already added)
```

## Step 3 — check

```sql
select count(*) from public.exercises e
join public.companies c on c.id = e.company_id
where c.slug = 'pranayoga' and not e.is_archived;
-- expect 35 (more if the coach added their own)
```

Then on the dev link: log in as the demo coach → a client → Plans → New plan → pick an exercise → search
"vrikshasana": **Tree Pose** should come up.

## Run log

- Dev: not run yet.
- Mumbai: not run yet.

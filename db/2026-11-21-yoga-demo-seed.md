# 21 Nov 2026 — Yoga demo data (QA Yoga Solo + QA Yoga Studio) — DEV ONLY — NOT RUN YET

> **1. Run in: Dev — project `nnxrmaiinbmxfwzefbwx`**
> SQL Editor: https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new
>
> **2. Mumbai (prod): never.** Demo data only. Check the project ref in the address bar before running.

**Anand runs this; Claude does not.** The phone-friendly version of `scripts/seed-yoga-demo.ts` (same data). Adds
rows only (CLAUDE.md Rule #1): no `DELETE`, `DROP`, `TRUNCATE`. The one update sets `is_test` and
`client_module_enabled` on the two new QA companies. The helper function lives in `pg_temp` (gone when the editor
session ends). Needs Step 1 of `db/2026-11-21-activity-category.md` (run on dev 21 Nov).

**Order:**
- **A. In the app (dev link, Super Admin)**, create the two companies with **Create company**. Logins go through the
  app so they work like every other login:

  | Name | Slug | Company type | Business type | Admin login (phone) | Password |
  |---|---|---|---|---|---|
  | QA Yoga Solo | `qayogasolo` | Individual coach | Yoga | 9000011001 | 9000011001 |
  | QA Yoga Studio | `qayogastudio` | Gym | Yoga | 9000012001 | 9000012001 |

  Don't add branches (Step B does). Optional, for the studio: log in as its owner → Coaches → add **Ravi Shankar**
  9000012002 and **Pooja Hegde** 9000012003 (they then mark some batches). Without them the owner marks everything.
- **B.** Paste the whole SQL block below into the dev SQL Editor and Run. It prints one line per company.
- **C.** The checks at the end.

Running it again changes nothing: a company that already has a branch is skipped.

## Step B — the data

```sql
create or replace function pg_temp.seed_yoga(p_slug text, p_spec jsonb) returns text
language plpgsql as $fn$
declare
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_company uuid; v_type text; v_owner uuid; v_trainers uuid[];
  br jsonb; ba jsonb; v_branch uuid; v_batch_ids uuid[]; v_batch record; v_class uuid; v_marker uuid;
  m jsonb; i int; v_uid uuid; v_away uuid; v_joined date; v_start date; v_end date; v_plan text; v_months int;
  v_plans text[] := array['1 Month','3 Months','1 Month','6 Months','3 Months','1 Year'];
  v_day date; v_dow text; d int; n_classes int := 0; n_present int := 0; v_n int; k int := 0;
begin
  select id, business_type into v_company, v_type from public.companies where slug = p_slug;
  if v_company is null then raise exception 'No company with slug %: create it in Super Admin first (Step A)', p_slug; end if;
  if v_type is distinct from 'yoga' then raise exception '% is not a yoga company (business type %)', p_slug, v_type; end if;
  if exists (select 1 from public.branches where company_id = v_company) then
    return p_slug || ': already has branches, skipped (nothing changed)';
  end if;
  select id into v_owner from public.profiles where company_id = v_company and role = 'company_admin' order by created_at limit 1;
  if v_owner is null then raise exception '% has no owner login yet (Step A)', p_slug; end if;
  v_trainers := array(select id from public.profiles where company_id = v_company and role = 'coach' and archived_at is null order by created_at);

  update public.companies set is_test = true, client_module_enabled = true where id = v_company;

  -- Branches + batches
  for br in select * from jsonb_array_elements(p_spec->'branches') loop
    insert into public.branches (company_id, name, address) values (v_company, br->>'name', 'Demo address (QA)') returning id into v_branch;
    for ba in select * from jsonb_array_elements(br->'batches') loop
      insert into public.batches (company_id, branch_id, name, days, start_time, end_time)
      values (v_company, v_branch, ba->>'name', array(select jsonb_array_elements_text(ba->'days')), (ba->>'start')::time, (ba->>'end')::time);
    end loop;
  end loop;
  v_batch_ids := array(select id from public.batches where company_id = v_company order by branch_id, start_time, name);

  -- Yoga activity list (same as Step 2 of db/2026-11-21-activity-category.md)
  insert into public.dojo_activities (company_id, name, description, sort_order, is_default, category, created_by)
  select v_company, v.name, v.description, v.sort_order, v.is_default, v.category, v_owner
  from (values
    ('Surya Namaskar','Sun salutation rounds',1,true,'Asana'),
    ('Standing poses','Tadasana, Trikonasana, Virabhadrasana',2,false,'Asana'),
    ('Balancing poses','Vrikshasana, Garudasana',3,false,'Asana'),
    ('Seated & forward bends','Paschimottanasana, Baddha Konasana',4,false,'Asana'),
    ('Backbends','Bhujangasana, Dhanurasana, Ustrasana',5,false,'Asana'),
    ('Inversions','Sarvangasana, Halasana',6,false,'Asana'),
    ('Anulom Vilom','Alternate nostril breathing',7,false,'Pranayama'),
    ('Kapalbhati','Skull-shining breath',8,false,'Pranayama'),
    ('Bhastrika','Bellows breath',9,false,'Pranayama'),
    ('Bhramari','Humming bee breath',10,false,'Pranayama'),
    ('Ujjayi','Ocean breath',11,false,'Pranayama'),
    ('Breath awareness',null,12,false,'Meditation'),
    ('Om chanting',null,13,false,'Meditation'),
    ('Trataka','Candle gazing',14,false,'Meditation'),
    ('Guided meditation',null,15,false,'Meditation'),
    ('Shavasana','Final relaxation',16,true,'Yoga Nidra'),
    ('Body scan',null,17,false,'Yoga Nidra'),
    ('Sankalpa','Resolve',18,false,'Yoga Nidra'),
    ('Guided Yoga Nidra',null,19,false,'Yoga Nidra')
  ) as v(name, description, sort_order, is_default, category)
  on conflict do nothing;

  -- Members: no login (a placeholder Auth user, like the app's "no login" members), PT, branch + home batch,
  -- joined 5–8 weeks ago, one membership each. Member 1 due in 3 days, 2 in 6 days, 3 lapsed 10 days ago.
  i := 0;
  for m in select * from jsonb_array_elements(p_spec->'members') loop
    i := i + 1;
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'client-' || v_uid || '@nologin.getcoachboard.in', '', now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', m->>0), now(), now(), '', '', '', '');
    v_joined := v_today - (35 + floor(random() * 21))::int;
    select b.id, b.branch_id into v_batch from public.batches b where b.id = v_batch_ids[((i - 1) % array_length(v_batch_ids, 1)) + 1];
    insert into public.profiles (id, company_id, full_name, email, role, client_type, phone, country, currency,
      gender, age, branch_id, batch_id, primary_coach_id, created_at)
    values (v_uid, v_company, m->>0, 'client-' || v_uid || '@nologin.getcoachboard.in', 'client', 'pt',
      '+91' || ((p_spec->>'phoneBase')::bigint + i - 1), 'IN', 'INR', m->>1, (m->>2)::int, v_batch.branch_id, v_batch.id,
      case when coalesce(array_length(v_trainers, 1), 0) > 0 then v_trainers[((i - 1) % array_length(v_trainers, 1)) + 1] end,
      v_joined + time '09:30');
    if i = 4 then v_away := v_uid; end if;
    v_plan := v_plans[((i - 1) % 6) + 1];
    v_months := case v_plan when '1 Month' then 1 when '3 Months' then 3 when '6 Months' then 6 else 12 end;
    v_start := case i when 1 then (v_today + 3 - make_interval(months => v_months))::date
                      when 2 then (v_today + 6 - make_interval(months => v_months))::date
                      when 3 then (v_today - 10 - make_interval(months => v_months))::date
                      else v_joined end;
    v_end := (v_start + make_interval(months => v_months))::date;
    if i > 3 and v_end <= v_today + 7 then v_start := v_today - 7; v_end := (v_start + make_interval(months => v_months))::date; end if;
    insert into public.memberships (profile_id, company_id, plan_type, amount_paid, start_date, end_date, currency)
    values (v_uid, v_company, v_plan,
      case v_plan when '1 Month' then 2500 when '3 Months' then 6500 when '6 Months' then 12000 else 22000 end,
      v_start, v_end, 'INR');
  end loop;

  -- Two weeks of classes (the 14 days before today; today stays open for the live demo):
  -- pre-ticked activities + 3–5 others, ~80% of the home members present; member 4 away the last 10 days
  for d in reverse 14..1 loop
    v_day := v_today - d;
    v_dow := (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[extract(isodow from v_day)::int];
    k := 0;
    for v_batch in select b.id, b.end_time from public.batches b where b.id = any(v_batch_ids) order by b.branch_id, b.start_time, b.name loop
      k := k + 1;
      continue when not exists (select 1 from public.batches b where b.id = v_batch.id and v_dow = any(b.days));
      v_marker := case when coalesce(array_length(v_trainers, 1), 0) > 0 and k % 3 <> 0
                       then v_trainers[((k - 1) % array_length(v_trainers, 1)) + 1] else v_owner end;
      insert into public.batch_classes (company_id, batch_id, class_date, logged_by, logged_at)
      values (v_company, v_batch.id, v_day, v_marker, (v_day + v_batch.end_time) at time zone 'Asia/Kolkata')
      returning id into v_class;
      insert into public.batch_class_activities (company_id, class_id, activity_id, activity_name, removed_at)
      select v_company, v_class, a.id, a.name, null from (
        (select id, name from public.dojo_activities where company_id = v_company and is_default)
        union all
        (select id, name from public.dojo_activities where company_id = v_company and not is_default
         order by random() limit 3 + floor(random() * 3)::int)
      ) a;
      insert into public.attendance (company_id, batch_id, profile_id, class_date, present, is_drop_in, marked_by, marked_at)
      select v_company, v_batch.id, p.id, v_day, true, false, v_marker, (v_day + v_batch.end_time) at time zone 'Asia/Kolkata'
      from public.profiles p
      where p.company_id = v_company and p.role = 'client' and p.batch_id = v_batch.id
        and random() < 0.8 and not (p.id = v_away and d <= 10);
      get diagnostics v_n = row_count;
      n_classes := n_classes + 1; n_present := n_present + v_n;
    end loop;
  end loop;

  return format('%s: %s branches, %s batches, %s members, %s trainers, %s classes, %s present marks',
    p_slug, jsonb_array_length(p_spec->'branches'), array_length(v_batch_ids, 1), i,
    coalesce(array_length(v_trainers, 1), 0), n_classes, n_present);
end
$fn$;

select pg_temp.seed_yoga('qayogasolo', '{
  "phoneBase": 9000011101,
  "branches": [{"name": "Home studio", "batches": [
    {"name": "Morning Hatha", "days": ["Mon","Tue","Wed","Thu","Fri","Sat"], "start": "06:30", "end": "07:30"},
    {"name": "Evening Flow",  "days": ["Mon","Wed","Fri"], "start": "18:00", "end": "19:00"}]}],
  "members": [["Ananya Rao","Female",34],["Kavya Menon","Female",29],["Rohit Sharma","Male",41],["Lakshmi Narayan","Female",52],
    ["Vikram Reddy","Male",37],["Sneha Kulkarni","Female",26],["Arjun Nair","Male",45],["Priya Desai","Female",31],
    ["Suresh Babu","Male",58],["Divya Pillai","Female",38]]
}'::jsonb)
union all
select pg_temp.seed_yoga('qayogastudio', '{
  "phoneBase": 9000012101,
  "branches": [
    {"name": "Jubilee Hills", "batches": [
      {"name": "Sunrise Hatha",  "days": ["Mon","Tue","Wed","Thu","Fri"], "start": "06:00", "end": "07:00"},
      {"name": "Power Vinyasa",  "days": ["Tue","Thu","Sat"], "start": "07:15", "end": "08:15"},
      {"name": "Evening Gentle", "days": ["Mon","Wed","Fri"], "start": "18:30", "end": "19:30"}]},
    {"name": "Kondapur", "batches": [
      {"name": "Morning Hatha", "days": ["Mon","Tue","Wed","Thu","Fri","Sat"], "start": "06:30", "end": "07:30"},
      {"name": "Weekend Flow",  "days": ["Sat","Sun"], "start": "08:00", "end": "09:00"}]}],
  "members": [["Aditi Joshi","Female",28],["Rahul Verma","Male",35],["Meghna Shah","Female",44],["Karthik Subramanian","Male",39],
    ["Fatima Sheikh","Female",33],["Sanjay Gupta","Male",55],["Ishita Bose","Female",24],["Naveen Kumar","Male",30],
    ["Revathi Krishnan","Female",49],["Aman Malhotra","Male",27],["Shruti Agarwal","Female",36],["Deepak Rao","Male",61],
    ["Tanvi Patil","Female",32],["Harish Chandra","Male",47],["Neha Saxena","Female",40],["Gopal Iyengar","Male",66]]
}'::jsonb);
```

Expected: two lines, e.g. `qayogasolo: 1 branches, 2 batches, 10 members, 0 trainers, 18 classes, 70 present marks`.
If it stops with an error, nothing from that run is kept (the whole block is one transaction): send the message.

## Step C — checks (read-only)

```sql
select c.slug, c.company_type, c.business_type, c.is_test,
  (select count(*) from public.branches b where b.company_id = c.id) as branches,
  (select count(*) from public.batches b where b.company_id = c.id) as batches,
  (select count(*) from public.profiles p where p.company_id = c.id and p.role = 'client') as members,
  (select count(*) from public.dojo_activities a where a.company_id = c.id and a.category is not null) as activities,
  (select count(*) from public.batch_classes x where x.company_id = c.id) as classes,
  (select count(*) from public.attendance x where x.company_id = c.id and x.present) as present
from public.companies c where c.slug in ('qayogasolo', 'qayogastudio');
-- qayogasolo:   coach, yoga, true, 1, 2, 10, 19, 18, ~70
-- qayogastudio: gym,   yoga, true, 2, 5, 16, 19, 38, ~100
```

## Run log

- Dev: not run yet
- Mumbai: never

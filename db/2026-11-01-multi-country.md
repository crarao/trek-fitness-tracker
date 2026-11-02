# 1 Nov 2026 — Multi-country clients & per-currency income — Step 0 + 0b run 2 Nov; ✅ ALL STEPS RUN 2 NOV (0, 0b, 1a, 1b)

> **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`** (the live app).
> SQL Editor: https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new
> Check the address bar shows `nptxjfvkqjuekgkspemu` before running. The old Tokyo project
> (`rzndxzhmgxkxihnwqnoy`) is not used by the app.

**Anand runs this; Claude does not.** Additive only: no `DROP`, no `DELETE`, no `TRUNCATE` (CLAUDE.md Rule #1), except the one country-rule drop in Step 0b, approved and run by Anand 2 Nov.

**Order (revised 2 Nov, to test on the preview first):**
1. Step 0 checks → Step 0b (done 2 Nov).
2. **Step 1a** (safe with the old app live) → test everything on the preview.
3. Merge `multi-country` into `main` (goes live) → **Step 1b** (phones) → Step 2 (phones left for review) → Step 3 (checks).

What it does (decisions D1–D5 in `multi-country-plan.md`):
- **companies:** `country` = home country, `currency` = base currency (both reused, nothing to sync).
  New `multi_country_enabled` (default off) and `allowed_currencies` (default `{INR}`, set to `{<its currency>}` for every
  existing company). A check makes sure the base currency is always one of the allowed ones.
- **profiles (clients):** new `country` and `currency` (the client's own; filled from their gym). Client phones that are
  exactly 10 digits become international format: `+1…` in US gyms, `+91…` everywhere else. Anything else is left as it is
  and listed in Step 2. Staff phones (owner, partners, coaches) are not touched. **Logins don't change**: the login
  identifier lives in Supabase Auth, not in `profiles.phone`.
- **memberships:** new `currency`, filled from the gym's currency, then `not null` (default `INR`).
  A trigger stops a saved payment's currency from ever changing.
- **protect_profile_columns:** clients (and coaches) can't change their own `country` / `currency`.
- **RLS:** no new tables, so no new rules. The new columns are covered by the existing `iso <table> <action>` rules
  (memberships already has its UPDATE rule). `protect_company_columns` already lets only super admin change company settings.

---

## Step 0 — check the live trigger function first

Step 1 replaces `protect_profile_columns()` starting from its latest version in the repo
(`db/2026-10-30-coach-view.md` Step 4: clients **and coaches** can't change `client_type`, `archived_at`, `primary_coach_id`).
Make sure the live one is that version:

```sql
select pg_get_functiondef('public.protect_profile_columns()'::regprocedure);
```

Expect the body to contain `public.get_my_role() in ('client', 'coach')` and `primary_coach_id`. **If it looks different,
stop and send it to Claude** (Step 1 would otherwise overwrite something newer).

Also check nothing limits `companies.country` / `currency` to the old two values:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.companies'::regclass and contype = 'c';
```

If a rule mentions `country` or `currency` with only `'IN'` / `'US'` / `'INR'` / `'USD'`, stop and tell Claude
(a UAE / Canada company couldn't be saved).

**Step 0 run by Anand 2 Nov 2026 on Mumbai:**
- `protect_profile_columns()` matched the 30 Oct version (coach-view Step 4) exactly → Step 1 item 5 is safe.
- Found `companies_country_check CHECK (country = ANY (ARRAY['IN', 'US']))` (no rule on `currency`). Other checks:
  `companies_company_type_check`, `companies_partner_limit_check`, `companies_slug_format` (unchanged).

### Step 0b — country rule widened to IN / AE / US / CA — ✅ RUN BY ANAND 2 NOV

Postgres can't edit a check in place, so the old rule was dropped and re-added with the four countries.
This one drop was explained in the conversation and run by Anand himself (Rule #1: only this rule, no data removed;
every company row unchanged).

```sql
-- ALREADY RUN 2 Nov 2026 — do not run again
alter table public.companies drop constraint companies_country_check;
alter table public.companies
  add constraint companies_country_check check (country = any (array['IN', 'AE', 'US', 'CA']));
```

Result: "Success. No rows returned". Check:

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'companies_country_check';
-- expect CHECK ((country = ANY (ARRAY['IN'::text, 'AE'::text, 'US'::text, 'CA'::text])))
```

Undo would mean dropping this rule again and re-adding the IN / US one: ask Claude first (needs Anand's OK for that drop),
and only if no company uses AE or CA.

---

## Step 1 — split in two (2 Nov), so the preview can be tested before production

The preview (branch `multi-country`) and the live app (`main`) use the **same** Mumbai database. So Step 1 is in two parts:

- **Step 1a — safe while the old code is live.** New columns, checks and triggers only; no phone changes.
  After it, the preview shows all the multi-country screens. The live app keeps working: it never reads the new columns,
  and a payment it saves without a currency gets the gym's own currency from a trigger (no `INR` default, which would
  have been wrong for US gyms).
  One thing to avoid until the merge: don't change a company's **Country** in the *live* super admin (getcoachboard.com):
  the old screen sets the currency without the new allowed list, and the save is refused. Use the preview's super admin.
- **Step 1b — only after `multi-country` is merged and live.** Client phones to `+91…` / `+1…` (the old app's
  WhatsApp Remind / Follow Up needs exactly 10 digits, so this waits), and fills country / currency for clients added in between.

Each part runs once. A second run stops with "already exists" and rolls back, nothing half-done.

### Step 1a — ✅ RUN BY ANAND 2 NOV (Mumbai) — do not run again

Check after: `companies.allowed_currencies` and `memberships.currency` exist, triggers `fill_membership_currency` +
`protect_membership_currency` present (true / true / 2). The first attempt showed "Failed to fetch" (browser lost the
connection; the check showed nothing had run), the second went through.

```sql
begin;

-- 1. companies (D1: country/currency reused as home country / base currency)
alter table public.companies
  add column if not exists multi_country_enabled boolean not null default false,
  add column if not exists allowed_currencies text[] not null default array['INR'];
update public.companies set country = coalesce(country, 'IN'), currency = coalesce(currency, 'INR');
update public.companies set allowed_currencies = array[currency]
  where not (currency = any(allowed_currencies));
alter table public.companies
  add constraint companies_base_currency_allowed check (currency = any(allowed_currencies));

-- 2. clients: own country and currency (filled from their gym). Phones are NOT changed here (Step 1b).
alter table public.profiles
  add column if not exists country text,
  add column if not exists currency text;
update public.profiles p set
  country  = coalesce(p.country,  c.country,  'IN'),
  currency = coalesce(p.currency, c.currency, 'INR')
from public.companies c
where c.id = p.company_id and p.role = 'client';

-- 3. memberships (D2): currency from the gym; a payment saved without one gets the gym's currency
alter table public.memberships add column if not exists currency text;
update public.memberships m set currency = coalesce(c.currency, 'INR')
  from public.companies c where c.id = m.company_id and m.currency is null;
update public.memberships set currency = 'INR' where currency is null;

create or replace function public.fill_membership_currency() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.currency is null then
    select coalesce(c.currency, 'INR') into new.currency from public.companies c where c.id = new.company_id;
    new.currency := coalesce(new.currency, 'INR');
  end if;
  return new;
end $$;
create trigger fill_membership_currency before insert on public.memberships
  for each row execute function public.fill_membership_currency();
alter table public.memberships alter column currency set not null;

-- 4. a saved payment's currency never changes
create or replace function public.protect_membership_currency() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.currency is distinct from old.currency then
    raise exception 'A saved payment''s currency cannot be changed';
  end if;
  return new;
end $$;
create trigger protect_membership_currency before update on public.memberships
  for each row execute function public.protect_membership_currency();

-- Trigger functions aren't callable directly (same as #50 Step 2)
revoke execute on function public.fill_membership_currency() from public, anon, authenticated;
revoke execute on function public.protect_membership_currency() from public, anon, authenticated;

-- 5. clients may not change their own country / currency.
--    Latest version (db/2026-10-30-coach-view.md Step 4, matched live 2 Nov) with every check kept.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() = 'super_admin' then return new; end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id then
    raise exception 'Not allowed to change role or company';
  end if;
  if public.get_my_role() in ('client', 'coach')
     and (new.client_type is distinct from old.client_type
          or new.archived_at is distinct from old.archived_at
          or new.primary_coach_id is distinct from old.primary_coach_id
          or new.country is distinct from old.country
          or new.currency is distinct from old.currency) then
    raise exception 'Not allowed to change membership type, archive status, primary coach, country or currency';
  end if;
  return new;
end $$;

commit;
```

### Step 1b — ✅ RUN BY ANAND 2 NOV, after PR #88 was merged and live — do not run again

Result: "Success. No rows returned".

```sql
begin;
-- Clients added by the old app in between: fill country / currency from their gym
update public.profiles p set
  country  = coalesce(p.country,  c.country,  'IN'),
  currency = coalesce(p.currency, c.currency, 'INR')
from public.companies c
where c.id = p.company_id and p.role = 'client' and (p.country is null or p.currency is null);

-- Client phones that are exactly 10 digits → international format (US gyms +1, everyone else +91)
update public.profiles p set
  phone = '+' || case when c.country = 'US' then '1' else '91' end || p.phone
from public.companies c
where c.id = p.company_id and p.role = 'client' and p.phone ~ '^\d{10}$';
commit;
```

---

### Original single Step 1 (replaced by 1a + 1b above — do not run)

Kept for the record. Differences: 1a has no `default 'INR'` on `memberships.currency` (the fill trigger takes the gym's
currency instead), and the phone change moved to 1b.

```sql
begin;

-- 1. companies (D1: country/currency reused as home country / base currency)
alter table public.companies
  add column if not exists multi_country_enabled boolean not null default false,
  add column if not exists allowed_currencies text[] not null default array['INR'];
update public.companies set country = coalesce(country, 'IN'), currency = coalesce(currency, 'INR');
update public.companies set allowed_currencies = array[currency]
  where not (currency = any(allowed_currencies));
alter table public.companies
  add constraint companies_base_currency_allowed check (currency = any(allowed_currencies));

-- 2. clients: country, currency, phone in international format (by the company's country)
alter table public.profiles
  add column if not exists country text,
  add column if not exists currency text;
update public.profiles p set
  country  = coalesce(p.country,  c.country,  'IN'),
  currency = coalesce(p.currency, c.currency, 'INR'),
  phone = case
    when p.phone ~ '^\d{10}$' then '+' || case when c.country = 'US' then '1' else '91' end || p.phone
    else p.phone end
from public.companies c
where c.id = p.company_id and p.role = 'client';

-- 3. memberships (D2)
alter table public.memberships add column if not exists currency text;
update public.memberships m set currency = coalesce(c.currency, 'INR')
  from public.companies c where c.id = m.company_id and m.currency is null;
update public.memberships set currency = 'INR' where currency is null;
alter table public.memberships alter column currency set default 'INR';
alter table public.memberships alter column currency set not null;

-- 4. a saved payment's currency never changes
create or replace function public.protect_membership_currency() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.currency is distinct from old.currency then
    raise exception 'A saved payment''s currency cannot be changed';
  end if;
  return new;
end $$;
create trigger protect_membership_currency before update on public.memberships
  for each row execute function public.protect_membership_currency();

-- 5. clients may not change their own country / currency.
--    Latest version (db/2026-10-30-coach-view.md Step 4) with every check kept; country / currency added to the client block.
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() = 'super_admin' then return new; end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id then
    raise exception 'Not allowed to change role or company';
  end if;
  if public.get_my_role() in ('client', 'coach')
     and (new.client_type is distinct from old.client_type
          or new.archived_at is distinct from old.archived_at
          or new.primary_coach_id is distinct from old.primary_coach_id
          or new.country is distinct from old.country
          or new.currency is distinct from old.currency) then
    raise exception 'Not allowed to change membership type, archive status, primary coach, country or currency';
  end if;
  return new;
end $$;

commit;
```

`create or replace` keeps `protect_profile_columns`' existing permissions (callers still can't run it directly; #50 Step 2).

---

## Step 2 — client phones that weren't exactly 10 digits (left unchanged, for review)

```sql
select c.name as gym, c.country, p.full_name, p.phone
from public.profiles p join public.companies c on c.id = p.company_id
where p.role = 'client' and p.phone is not null and p.phone <> ''
  and p.phone !~ '^\+\d+$'
order by c.name, p.full_name;
```

These still work in the app where they can be read (e.g. `098490 11234`, `+91 98490 11234` are understood).
Fix any odd ones from the member's Edit panel; saving writes the international format.

---

## Step 3 — checks

```sql
-- a) New columns: expect 5 rows (memberships.currency not null, default 'INR')
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'companies'   and column_name in ('multi_country_enabled', 'allowed_currencies'))
    or (table_name = 'profiles'    and column_name in ('country', 'currency'))
    or (table_name = 'memberships' and column_name = 'currency'));

-- b) Every company: multi-country off, allowed = its own currency
select name, country, currency, multi_country_enabled, allowed_currencies from public.companies order by name;

-- c) No membership without a currency; totals per gym and currency (should match the dashboards)
select count(*) as missing_currency from public.memberships where currency is null;                -- 0
select c.name, m.currency, count(*), sum(m.amount_paid)
from public.memberships m join public.companies c on c.id = m.company_id
group by c.name, m.currency order by c.name, m.currency;

-- d) Client phones by format: expect only '+91…' / '+1…' plus the Step 2 rows
select case when phone ~ '^\+91\d{10}$' then '+91 + 10' when phone ~ '^\+1\d{10}$' then '+1 + 10'
            when phone is null or phone = '' then 'none' else 'other' end as format, count(*)
from public.profiles where role = 'client' group by 1 order by 1;

-- e) Triggers: expect fill_membership_currency + protect_membership_currency on memberships, protect_profile_columns on profiles
select tgname, tgrelid::regclass from pg_trigger
where tgname in ('fill_membership_currency', 'protect_membership_currency', 'protect_profile_columns');

-- f) The currency lock works (rolled back, changes nothing): expect ERROR "A saved payment's currency cannot be changed"
begin;
update public.memberships set currency = 'USD' where id = (select id from public.memberships limit 1);
rollback;
```

---

## Undo

Rule #1: nothing here drops or deletes. The added columns, the check and the trigger can stay: the old app never reads them.
To put behaviour back as it was:

```sql
begin;
-- 1. Multi-country off everywhere
update public.companies set multi_country_enabled = false;

-- 2. Client phones back to 10 digits (only the exact formats the backfill wrote)
update public.profiles set phone = substring(phone from 4) where role = 'client' and phone ~ '^\+91\d{10}$';
update public.profiles set phone = substring(phone from 3) where role = 'client' and phone ~ '^\+1\d{10}$';

-- 3. Currency lock off (functions become no-ops; the triggers stay). fill_membership_currency can stay as it is.
create or replace function public.protect_membership_currency() returns trigger
language plpgsql set search_path = public as $$
begin
  return new;
end $$;

-- 4. protect_profile_columns back to the 30 Oct version (db/2026-10-30-coach-view.md Step 4)
create or replace function public.protect_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if public.get_my_role() = 'super_admin' then return new; end if;
  if new.role is distinct from old.role
     or new.company_id is distinct from old.company_id then
    raise exception 'Not allowed to change role or company';
  end if;
  if public.get_my_role() in ('client', 'coach')
     and (new.client_type is distinct from old.client_type
          or new.archived_at is distinct from old.archived_at
          or new.primary_coach_id is distinct from old.primary_coach_id) then
    raise exception 'Not allowed to change membership type, archive status or primary coach';
  end if;
  return new;
end $$;
commit;
```

Removing the columns, the `companies_base_currency_allowed` check or the trigger itself would need a `DROP`:
only with Anand's explicit OK for that specific drop.

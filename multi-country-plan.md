# Multi-country clients & per-currency income — build plan (approved 1 Nov 2026)

Paste the **Kickoff prompt** at the bottom into a new Claude Code session tomorrow.
Nothing has been built yet. No code edited, no SQL run.

---

## Decisions (agreed)

| # | Decision |
|---|---|
| D1 | **Reuse** existing `companies.country` (= home country) and `companies.currency` (= base currency). No new `home_country` / `base_currency` columns, nothing to sync. Relabel them "Home country" / "Base currency" in the Super Admin UI. Base currency is always in `allowed_currencies`: in the admin form its checkbox is locked on, and a DB check `currency = any(allowed_currencies)` backs that up. Changing the country pre-fills the currency (IN→INR, AE→AED, US→USD, CA→CAD), and super admin can override it. |
| D2 | **No `payments` table.** Add `currency` to `memberships` only (a membership row *is* the payment today). "Record a payment" = add or renew a membership. |
| D3 | Only the **existing** money figures are split by currency: This Month (collected), its plan drill-in and 6-month trend, and Expiring Soon "at risk" (due). No new overdue amount. Grouped "₹48,000 · AED 3,200" lines appear only when more than one currency has amounts. A company with a single currency (an INR gym, or a US gym with only USD) sees exactly today's dashboard, % vs last month and trend bars included. |
| D4 | Client login unchanged. Indian clients keep the 10-digit phone login. Non-Indian clients get a login only with an email, as US clients do today. `loginMethod()` returns `'phone'` only for IN, so AE / CA / US companies' clients log in by email. |
| D5 | Existing US companies' staff stay on email login. New AE / CA staff, and new US staff, can use phone login with the country code. |
| WA | WhatsApp for international numbers is out of scope. Only make sure existing IN / US reminders still work after phones are stored as `+91…` / `+1…`. Otherwise the dashboard Remind / Follow Up buttons break, because they check for exactly 10 digits at `app/company/page.tsx:1715`. |
| ⚠ | **Not yet confirmed: checklist item 5.** The UAE company only allows AED + INR, so plan to run item 5 on an Indian test gym with multi-country on and INR + USD allowed. Confirm with Anand. |

## Login-identifier rule (one helper, no inline copies)

`lib/phone.ts` → `loginEmailFor(countryCode, localDigits)`
- +91 → `9876543210@getcoachboard.in` (unchanged, no migration of existing users)
- every other country → full digits including the country code, e.g. `971501234567@getcoachboard.in`, `15551234567@getcoachboard.in`
- Digit lengths: IN 10, AE 9, US 10, CA 10.

Inline copies that must be replaced with the helper:
- `app/login/page.tsx:110` (`toEmail`)
- `app/admin/page.tsx:317, 319, 588` (company admin login, partner login)
- `app/company/page.tsx:381` (coach), `:554` (client: keep the IN-only behaviour, built from the local 10 digits)
- `app/api/update-client/route.ts:55-56` (phone → auth email sync; must accept the `+91` stored format)
- `app/api/update-coach/route.ts:40`

## New shared code
- `lib/phone.ts`: country table `{ IN: +91/10/INR, AE: +971/9/AED, US: +1/10/USD, CA: +1/10/CAD }`, plus `loginEmailFor`, `validLocalDigits`, `toE164`, `splitE164`, `waDigits` (IN / US only).
- `app/country-code-picker.tsx`: reusable picker, default +91. It's the first shared component, so note it in CLAUDE.md's "Component structure" section.
- `lib/currency.ts`: symbols ₹ / AED / $ / CA$, `formatMoney` for all four, `groupByCurrency()`, `formatMoneyByCurrency()`.
- `lib/locale.ts`: add AE and CA to `Country` and `COUNTRIES`; `dialCode` from the table; `loginMethod` returns `'phone'` only for IN.
- `scripts/check-phone.ts`: checks for the helper, in the same style as the other `scripts/check-*.ts`.

## Files to change
| File | Change |
|---|---|
| `app/login/page.tsx` | Country-code picker (default +91), digit check, `loginEmailFor`; email input still works |
| `app/admin/page.tsx` | Create/edit: Home country (IN/AE/US/CA), Base currency, Multi-country toggle, Allowed-currency checkboxes; admin + partner phone via picker + helper |
| `app/company/page.tsx` | Coach login via helper; Add client: country / phone code / currency only if multi-country on; membership insert gets `currency`; currency picker by the amount (hidden when off); income grouped per currency (D3); Remind buttons use `waDigits` |
| `app/company/client/[id]/page.tsx` | Edit client country/phone/currency (multi-country only); Renew carries forward the latest membership's currency; Correct never changes currency; every amount in its row's own currency |
| `app/api/create-user/route.ts` | Accept + store `country`, `currency`; reject a currency not in `allowed_currencies` |
| `app/api/update-client/route.ts` | Phone/auth sync via helper with `+91` format; save country/currency; never touch memberships |
| `app/api/update-coach/route.ts` | Login email via helper |
| `app/client/page.tsx` | Show the client's membership amount in its own currency |
| `CLAUDE.md`, `ROADMAP.md` | New fields, login-identifier rule, new helpers/component |
| `db/2026-11-01-multi-country.md` | Migration (below), with the Mumbai header |

Multi-country **off** ⇒ no new fields anywhere; forms look exactly as today.
A currency that has since been removed from `allowed_currencies`: saved rows keep it and still display correctly. Pickers offer only allowed ones. A renewal carries it forward unless the coach changes it.

## Migration draft → `db/2026-11-01-multi-country.md`
Header: **Run in: Mumbai — project `nptxjfvkqjuekgkspemu`**, link
https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new — check the address bar first.
Anand runs it; Claude does not. Additive only: no DROP, no DELETE.

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

-- 5. clients may not change their own country / currency:
--    `create or replace` public.protect_profile_columns() starting from its LATEST version
--    (db/2026-10-30-rls-hardening.md); keep every existing check, add country/currency to the client block.

commit;
```
Also in the file:
- a SELECT listing client phones that weren't exactly 10 digits (left unchanged, for review)
- verification SELECTs
- an Undo section

**RLS:** no new tables, so no new policies. New columns are covered by the existing `iso <table> select/insert/update/delete` rules (memberships already has its UPDATE rule). `protect_company_columns` already lets only super admin change company settings.

## Test checklist (walk Anand through it)
1. Existing Indian coach logs in with 10-digit number: works unchanged.
2. Super Admin creates a UAE coach company: AE / AED, multi-country on, allowed AED + INR.
3. UAE coach logs in with a +971 number.
4. Add one UAE client (AED) and one Indian client (INR).
5. Change a US client's currency to INR: override works. *(Indian test gym, INR + USD allowed; confirm.)*
6. Record a payment for each; edit a client's currency afterwards and confirm old payments keep their original currency.
7. Dashboard shows separate AED and ₹ totals.
8. An Indian gym with multi-country off sees no new fields anywhere.

Extra checks:
- An INR-only gym's dashboard is identical to before.
- WhatsApp Remind still works after the `+91` backfill.
- A US gym's email login is unchanged.

Environment: Anand is on Windows PowerShell. Any command for him uses `Get-ChildItem -Recurse | Select-String`, not grep.

---

## Kickoff prompt (paste tomorrow)

> Read CLAUDE.md, then `multi-country-plan.md` in the repo root. That plan is approved: build it exactly as written (decisions D1–D5 are final). Confirm checklist item 5 with me first, then start. Follow RULE #1 (no deletion). Do not run the SQL: write it to `db/2026-11-01-multi-country.md` for me to run. When done, update CLAUDE.md and walk me through the test checklist.

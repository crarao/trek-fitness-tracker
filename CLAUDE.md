@AGENTS.md

# ⛔ RULE #1 — NO DELETION (read before doing anything)

Claude must never delete anything in this project — code or data.

- **Code / files:** do not delete files or folders, do not `git rm`, do not delete branches, do not force-push, do not reset or discard commits. Do not remove existing features or blocks of code. Editing a line in place is fine; removing code that isn't being directly replaced is not.
- **Database (Supabase):** never run `DELETE`, `DROP`, `TRUNCATE`, or `ALTER TABLE ... DROP COLUMN`, and never write migrations or scripts that do. Never reset the database. Never delete auth users.
- **If a task seems to need a deletion:** stop, explain exactly what would be deleted and why, and wait. Only proceed if Anand explicitly approves that specific deletion in the conversation.
- This rule is about what Claude does. It does not mean removing the app's own delete features (delete client, archive, delete company) — leave those as they are.

`.claude/settings.json` also blocks common delete commands as a backstop. Do not edit or weaken it.

# CoachBoard — Session Reference

## Project Overview

Multi-tenant fitness coaching SaaS (white-labeled as "CoachBoard"). Companies sign up, add clients, assign AI-generated workout plans, and track progress. Originally trek-focused; now supports gym, pilates, yoga, cycling, and general coaching.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth) · Tailwind CSS 4 · Chart.js · Anthropic Claude Haiku (AI plans + insights) · Vercel (hosting)

**Stage:** Active development. Core flows fully working. First customer trial underway as of April 2026. Work goes to the `dev` branch first (dev Supabase + dev link), then `main` = production on Vercel; see Conventions → Dev / prod setup.

---

## User Roles

Roles are stored in `profiles.role`. Login always goes through `/login`, then redirects by role.

### `super_admin` → `/admin`
Platform owner (Anand). Manages all companies: create, edit, activate/deactivate, set `client_limit` and `pt_limit`, toggle per-company feature flags (`feedback_enabled`, `ai_insights_enabled`, `session_notes_enabled`, `client_module_enabled`), manage subscription status, add/remove partner logins per company.

### `company_admin` → `/company`, `/company/client/[id]`
Coach/org admin scoped to their own company. Creates and manages clients (up to `client_limit`), assigns AI-generated weekly plans (Claude Haiku, business-type-aware), reviews session logs, provides written feedback on sessions. Sees subscription countdown banner when account is near expiry.

### `partner` → `/company`
Staff login for a gym (receptionist, branch manager). Same dashboard view as `company_admin`. Added by super_admin per company, up to `companies.partner_limit` (default 2; only super admin changes it). Default password = phone number. Future: will be scoped to a branch via `branch_id` when branch filtering ships.

### `coach` → `/coach`, `/company/client/[id]` (ROADMAP #40)
Gym coach. Added by the owner or a partner from the dashboard's Coaches section (no limit, not counted in `client_limit`); turned off with `archived_at` + an auth ban via `/api/set-coach-active`, never deleted. `/coach` is today's training list (who is expected today, done or not; no missed / follow-up prompts). Sees **all PT clients** of the gym plus staff names: opens any PT client, sees plans, sessions, progress and the "Before you start" card, marks done, logs sessions, creates and edits plans (AI cap applies; `generate-plan` and `ai-plan-usage` allow `PLAN_ROLES`). Can't see payments / amounts, revenue, leads or settings, can't add / edit / archive / delete members, change the primary coach, give feedback (reads it) or delete plans. Membership only as plan and dates from `rpc('pt_membership_status')`: **never query `memberships` as a coach**. Every other API route is `STAFF` only and returns 403 to coaches. **Login / password:** India = phone number, first password = the phone number; other countries = email + password, or phone + country code (password = the number), see `staffLogin`. The owner / a partner sets a new password from Coaches → Password (`/api/reset-password` allows their own gym's coach logins); the coach changes their own from Password on `/coach` (`supabase.auth.updateUser`).

### `client` → `/client`
End user. Logs workout sessions, views assigned weekly plans, tracks progress via charts (activities/week, minutes/week, day streak), requests AI coaching insights. Feature visibility is controlled by per-company feature flags.

---

## Data Model

```
companies
  ├── name, email, phone, logo_url
  ├── is_active, is_trial, trial_end
  ├── client_limit, pt_limit
  ├── partner_limit (default 2)       ← owner-level partner logins; super admin only
  ├── feedback_enabled, ai_insights_enabled, session_notes_enabled
  ├── client_module_enabled
  ├── country (IN | AE | US | CA, default IN) ← HOME country: date format, phone code, client login method (Super Admin label "Home country")
  ├── currency (INR | AED | USD | CAD) ← BASE currency, pre-filled from the country, super admin can change it; always in allowed_currencies (DB check)
  ├── multi_country_enabled (bool, default false) ← super admin switch: clients from other countries / payments in other currencies (#75)
  ├── allowed_currencies (text[], default {INR}) ← currencies the gym takes; base always included
  ├── business_type (gym | martial_arts | yoga | pilates | cycling | trek | general) ← super admin sets it (Create / Edit company, lib/labels.ts BUSINESS_TYPES); empty counts as general. martial_arts = a dojo: Students wording, parent details ticked by default, reminders to the parent
  ├── company_type (gym | coach, default gym) ← super admin only; 'coach' = individual coach (#60), see lib/company-type.ts
  ├── grading_enabled (bool, default false) ← super admin only (belt grading; on for DSSKA via the SQL, no Super Admin switch yet). Off = no belt fields anywhere
  ├── upi_id (text, nullable) ← super admin sets it; added to the dojo fee reminder to parents (db/2026-11-07-upi-id.md). Owners can't change it
  ├── banner_has_branding (bool, default false) ← super admin switch: the uploaded banner already has the gym's name / logo, so the login shows it whole without name / tagline / logo on top (db/2026-10-31-banner-branding.md; readable logged out)
  └── slug (unique, nullable)          ← super admin sets it; gym address <slug>.getcoachboard.com (lib/tenant.ts) and login link /login/<slug> (→ /login?company=<slug>). Rules in lib/company-slug.ts, DB guard db/2026-10-31-company-slug.md

profiles (one per user, linked to a company)
  ├── role (super_admin | company_admin | partner | client | coach)
  ├── company_id → companies
  ├── client_type (member | pt)       ← PT = personal training client
  ├── archived_at (timestamptz null)  ← null = active, set = archived (for a coach: login turned off)
  ├── primary_coach_id → profiles     ← client's coach, picked from a dropdown (PT: primary coach; regular member: optional trainer). Soft link, never limits access; owner/partner set it. trainer_name = old free-text field, read-only now
  ├── full_name, email, phone          ← clients: international format +919876543210 (db/2026-11-01-multi-country.md); staff: India 10 digits, others +<code><digits>
  ├── country, currency (clients)      ← client's own country / default payment currency (= the gym's unless multi-country); clients can't change them
  ├── branch_id → branches, batch_id → batches (clients, nullable) ← a dojo student's branch and home batch (#77, db/2026-11-03-branches-batches.md); they can attend any batch. Clients / coaches can't change them (protect_profile_columns); must be in the same gym, batch at that branch
  ├── guardian_name, guardian_phone, guardian_relation (clients, nullable) ← parent / guardian (Dojo Build 1, #53, db/2026-11-03-guardian.md); phone stored like phone (+E.164); relation Mother / Father / Guardian. Reminders and progress shares go to this phone when it's valid
  ├── current_rank_id → belt_ranks, rank_achieved_on (date) (clients, nullable) ← the student's CURRENT belt and since when (belt grading). Belt must be in the same gym (FK on (company_id, current_rank_id)); clients / coaches can't change them (protect_profile_columns)
  └── fitness fields: goal, age, gender, height_cm, weight_kg,
      fitness_level, food_preference (Vegetarian | Non-Vegetarian | Eggetarian | Vegan | Jain),
      meals_per_day (smallint 2–6), available_days,
      medical_conditions, emergency_contact_name/phone,
      trainer_name, diet_plan

memberships (one row per plan period, multiple per profile)
  ├── profile_id → profiles
  ├── company_id → companies
  ├── plan_type (1 Month | 3 Months | 6 Months | 1 Year)
  ├── amount_paid
  ├── currency (not null) ← the currency it was paid in; filled from the gym's currency if not sent (trigger fill_membership_currency); NEVER changes once saved (trigger protect_membership_currency)
  ├── start_date, end_date
  └── created_at

weekly_plans
  ├── client_id → profiles
  ├── week_start, plan_details, workout_time
  └── created_at

logged_sessions
  ├── client_id → profiles
  ├── session_date, duration_minutes, notes
  ├── weekly_plan_id → weekly_plans (nullable)
  └── created_at

session_feedback
  ├── session_id → logged_sessions
  ├── star_rating (nullable)
  └── admin_feedback

leads (enquiries, #52; never deleted: they end as joined or lost)
  ├── company_id → companies
  ├── name, phone, source (walk_in | instagram | referral | website | whatsapp | other)
  ├── interest (membership | pt | trial | other)
  ├── status (new | trial | joined | lost)
  ├── follow_up_date (date), last_contacted_at, lost_reason, notes
  ├── converted_profile_id → profiles (set by "Convert to member")
  ├── created_by → profiles (defaults to auth.uid())
  └── created_at, updated_at (trigger keeps updated_at current)

branches (#77; never deleted: archived)
  ├── company_id → companies, name (unique per gym, case-insensitive), address
  └── is_archived, created_at

batches (#77, a class at one branch; never deleted: archived)
  ├── company_id → companies, branch_id → branches, name (unique per branch)
  ├── days text[] (Mon…Sun), start_time, end_time (time)
  └── is_archived, created_at

attendance (#78; never deleted: untap = present false)
  ├── company_id → companies, batch_id → batches, profile_id → profiles (client), class_date (date)
  ├── present (bool), is_drop_in (bool: not their home batch)
  ├── marked_by → profiles (who tapped last), marked_at
  └── unique (batch_id, profile_id, class_date)

belt_ranks (a gym's belt ladder; supabase/migrations/20261110120000_belt_grading.sql)
  ├── company_id → companies, rank_order (unique per gym), belt_name, kyu (null = White), color_hex, min_months_from_previous
  └── is_active (turn off instead of deleting; a belt used by a student or history can't be deleted: FK), created_at

student_grades (belt history: one row each time profiles.current_rank_id changes)
  ├── company_id, student_id → profiles, rank_id → belt_ranks (same gym), achieved_on (date, null = unknown)
  ├── source (joined | backfill | manual | exam), exam_id → grading_exams (null; exams are Phase 2)
  └── created_by → profiles, created_at

grading_exams, grading_exam_candidates (Phase 2: exam scheduling, parent notices, results; tables exist, no UI yet)

exercise_logs (weight / reps per exercise per session, #80)
  ├── session_id → logged_sessions, client_id → profiles, company_id → companies (copies, checked by RLS)
  ├── exercise_id → exercises (null = name not in the library), exercise_name (copy), name_key (generated)
  ├── position, sets, reps, weight (null = bodyweight), unit (kg; lb allowed, not in the app), set_details jsonb (unused)
  └── logged_by → profiles, created_at  (cascades with the session / client / company)

exercises (exercise library, #74; never deleted: archived)
  ├── company_id → companies (null = shared starter list, super admin only edits)
  ├── name (unique per gym, case-insensitive), aliases text[], muscle_group, equipment
  ├── is_archived, created_by → profiles, created_at
  └── plans keep a copy of the name in plan_json (+ optional exercise_id, weight)
```

**Membership history is preserved.** Every renewal inserts a new `memberships` row. `Correct Current` updates the latest row (for typos only). Latest membership = `ORDER BY start_date DESC LIMIT 1`.

**Archive convention.** `archived_at IS NULL` = active client. Setting `archived_at` hides the client from the dashboard, member list, and `client_limit` count. Renewing a membership auto-clears `archived_at`.

---

## Key Files

| Concern | File |
|---|---|
| Supabase browser client | `lib/supabase.ts` |
| Supabase admin client | Instantiated inline in each API route (no shared helper) |
| Public landing page (getcoachboard.com) | `app/page.tsx` — logged-in users redirect to `/dashboard` |
| Home page sections | hero → audience cards → #gyms → #coaches → testimonials (hidden until filled) → FAQ → #contact. Orange = gyms, blue = coaches. Only claims the product supports today. |
| Landing page content (testimonials, Instagram, walkthrough video IDs) | `app/landing-content.ts` |
| API auth check (every `/api` route calls this first) | `lib/auth-server.ts` (`getCaller`, `checkCanManageClient`) |
| Landing page contact form | `app/contact-form.tsx` → `app/api/contact/route.ts` → `contact_requests` table (read in /admin → Requests) |
| Auth + role routing | `app/login/page.tsx`, `app/dashboard/page.tsx` |
| Proxy (formerly middleware): login + role check per section | `proxy.ts` |
| Super admin UI | `app/admin/page.tsx` |
| Company admin dashboard | `app/company/page.tsx` |
| Client detail (coach view) | `app/company/client/[id]/page.tsx` |
| Leads / enquiries page | `app/company/leads/page.tsx` |
| Branches & batches page (dojos, owner / partner) | `app/company/batches/page.tsx` |
| Branches editor (super admin only; Super Admin → Companies → Edit) | `app/branches-editor.tsx` |
| Branch / batch rules (days, times, labels, sorting; check: `scripts/check-batches.ts`) | `lib/batches.ts` |
| Attendance roll call (one batch, one day) / all of today (table by batch) / monthly attendance (owner, partner, sensei) | `app/company/attendance/[batchId]/page.tsx`, `app/company/attendance/today/page.tsx`, `app/company/attendance/page.tsx` |
| Attendance rules (today's batches, roll call, month counts, parent message; check: `scripts/check-attendance.ts`) | `lib/attendance.ts` |
| Server check that a client's branch / batch is in their gym (create-user, update-client) | `lib/placement-server.ts` |
| Leads rules (sources, follow-up state, WhatsApp wording, summary) | `lib/leads.ts` |
| Exercise library rules (search, labels, recent) | `lib/exercises.ts` (check: `scripts/check-exercises.ts`) |
| Weight / reps logs: parse plan text, match names to the library, pre-fill from last log, monthly top weight / volume (check: `scripts/check-exercise-logs.ts`) | `lib/exercise-logs.ts` |
| Per-exercise progress chart (coach Progress tab) | `app/exercise-progress.tsx` |
| Plan builder: editor, exercise picker sheet, copy-plan sheet | `app/plan-editor.tsx`, `app/exercise-picker.tsx`, `app/plan-copy-sheet.tsx` |
| Manage the gym's exercises (owner / partner) | `app/company/exercises/page.tsx` |
| Client app | `app/client/page.tsx` |
| Coach home (today's training list) | `app/coach/page.tsx` |
| Coach rules (today's rows, Before you start, covering) | `lib/coach-today.ts` (check: `scripts/check-coach-today.ts`) |
| Today's schedule (owner / partners, gyms + individual coaches; read-only, PT sessions by workout time) | `app/company/today/page.tsx` |
| Today's schedule rules (expected / trained / not logged, covering, coach filter, time labels; check: `scripts/check-today-schedule.ts`) | `lib/today-schedule.ts` |
| Company type helpers (`isGym`, `isCoachCompany`, `companyType`) | `lib/company-type.ts` |
| Business type list + wording (`BUSINESS_TYPES`, `businessType`, `memberWord`, `isDojo`) | `lib/labels.ts` |
| Parent / guardian rules (`pickRecipient`, `reminderRecipient`, `reminderText`, `hasGuardian`; check: `scripts/check-guardian.ts`) | `lib/guardian.ts` |
| Phones + phone logins: country table (IN / AE / US / CA), `loginEmailFor`, `validLocalDigits`, `toE164`, `splitE164`, `displayPhone`, `waDigits`, `staffLogin` (check: `scripts/check-phone.ts`) | `lib/phone.ts` |
| Money: `formatMoney` (₹ / AED / $ / CA$), `groupByCurrency`, `formatMoneyByCurrency` | `lib/currency.ts` |
| Country-code picker (login, Add member, staff logins) — the one shared component | `app/country-code-picker.tsx` |
| Company slug rules (suggest from name, validate, reserved words, uniqueness check) | `lib/company-slug.ts` |
| Branded login link `/login/<slug>` (forwards to `/login?company=<slug>`) | `app/login/[slug]/page.tsx` |
| Gym subdomains: read the gym from the host (`tenantSlugFromHost`, `rootHost`, `gymAddress`) | `lib/tenant.ts` |
| Gym logo / banner upload (super admin edit panel → public Storage bucket `branding/<company id>/`, shrunk in the browser; rule in `db/2026-10-31-branding-upload.md`) | `lib/branding-upload.ts` |
| Login stock banner + tagline per business type (login page and the admin preview) | `lib/login-branding.ts` |
| API: create user | `app/api/create-user/route.ts` |
| API: delete user | `app/api/delete-user/route.ts` |
| API: delete company | `app/api/delete-company/route.ts` |
| API: update client | `app/api/update-client/route.ts` |
| API: turn a coach login off / on | `app/api/set-coach-active/route.ts` |
| API: rename a coach / change their phone (phone login follows) | `app/api/update-coach/route.ts` |
| API: AI plan generation | `app/api/generate-plan/route.ts` |
| API: AI coaching insights | `app/api/ai-insights/route.ts` |
| API: AI diet chart (staff, reads profile server-side) | `app/api/generate-diet/route.ts` |
| API: password reset | `app/api/reset-password/route.ts` |
| API: is a client username free (any gym) / give a no-login client a username login | `app/api/check-username/route.ts`, `app/api/create-login/route.ts` (shared: `lib/username-server.ts`) |
| Client username box (live check + suggestions; Add member, Create login) | `app/username-field.tsx` |

All active code is in `/app`. `/src` was deleted — it was a legacy directory.

---

## Reference Files

Sales, pricing, and product reference documents (HTML) — open in a browser, do not edit.

| Document | Path |
|---|---|
| Feature overview | `Reference Files/coachboard-features.html` |
| Infrastructure costs | `Reference Files/coachboard-infra-costs.html` |
| Pricing | `Reference Files/coachboard-pricing.html` |
| What's included (Manage) | `Reference Files/coachboard-whats-included.html` |
| **Pricing v2 (revised Apr 2026)** | `Reference Files/coachboard-pricing-4k.html` |

---

## What's Built (as of April 2026)

### Manage module (all companies)
- Member list with search (name/phone) and status filter tabs (All / Active / Expiring / Expired / **Archived**)
- Stat cards: Total Members, Expiring Soon (with ₹ at risk), Expired, This Month revenue
- Revenue card drill-in: tap to expand → breakdown by plan type + 6-month trend
- Plan breakdown bar chart (active + expiring members by plan type)
- CoachBoard subscription countdown card (green/amber/red)
- Add member form (full-screen overlay): name, phone, email, plan, amount, dates, trainer, diet, PT flag
- Edit member panel: name/phone + membership section (Renew = new row, Correct = update existing)
- Archive client: sets `archived_at`; archived clients hidden from dashboard and slot count
- Restore client: from archived tab list or from client detail page; renewing auto-restores
- Delete client: full cascade (session_feedback → logged_sessions → weekly_plans → memberships → profiles → auth)
- Delete company: full cascade including all members and auth users
- Partner logins: super_admin adds/removes per company; partner routes to `/company`
- PT member type: `client_type = 'pt'` flag; PT badge in list; separate slot counter
- Mobile-first + PWA: installable, responsive across phone/tablet/desktop
- WhatsApp reminders: one-tap pre-filled message for expiring/expired members

### Train module (PT clients, gated by `client_module_enabled`)
- 4-tab client detail view: Profile · Plans · Sessions · Progress
- AI plan generation (Claude Haiku, heading-only format, `max_tokens: 300`)
- Coach can edit generated plan before assigning
- Weekly plan assign/edit/delete
- Session logging by client (date, duration, notes)
- Coach feedback per session (written)
- Progress charts: activities/week (bar) + minutes/week (line) — Chart.js
- Day streak tracker
- AI coaching insights (client-triggered, `max_tokens: 200`)
- Membership card on PT profile tab (plan, dates, days left, history)

### Super admin controls per company
- `client_limit` — max active (non-archived) clients
- `pt_limit` — max PT clients (nullable = no limit)
- `client_module_enabled` — gates entire Train module
- `feedback_enabled`, `ai_insights_enabled`, `session_notes_enabled` — sub-feature toggles
- `ai_reports_enabled` — gates Monthly AI Coach Reports (Manage Pro tier)
- `is_active`, `is_trial`, `trial_end` — subscription state

---

## To-Do List

> **Current priorities live in [`ROADMAP.md`](ROADMAP.md)** — numbered items Anand refers to in chat ("do #11"). Tick items off there (with the PR number) when they ship. The notes below are older background detail.

### Current Sprint — Next Up
1. **Automated SMS reminders + reports** — daily cron (Vercel Cron or Supabase Edge Function) finds members expiring in 7 days or lapsed, triggers SMS via MSG91 or Twilio
2. **Member photos** *(pushed ~2 months, paying customer only)*
3. **Native app** *(pushed ~2 months)*

### Core Features Pending
- **Branch-level filtering** — requires `branch_id uuid nullable FK` column added to `profiles` in Supabase first; critical for The Fitness Edge demo ("show me just Jubilee Hills"); partner logins already built, just need this column
- **Coach assignment** — add `coach_id` on client record so owners see who handles whom; needed for accountability reports and coaches seeing only their clients
- **Owner-level multi-branch dashboard** — aggregate view across all branches with drill-in per branch; most important screen for The Fitness Edge pitch
- **Testing module integration** — pending
- **Payment tracking table** — separate `payments` table (`membership_id`, `profile_id`, `company_id`, `amount`, `payment_date`, `payment_method`, `notes`) for installment support; backfill existing `amount_paid` values; revenue dashboard switches to summing `payments.amount` by `payment_date`; build when a real installment case arises
- **Lapsed-member follow-up view** — filtered list of expired members with "Send reminder" action

### US Market Adaptation
- **Currency localization** — swap ₹ symbols and INR formatting for $ / USD throughout all UI and data display
- **Phone number format** — US 10-digit numbers; update auth email convention (`{phone}@getcoachboard.in`) and `update-client` sync accordingly; may need E.164 normalization
- **SMS provider** — replace MSG91 with a US-capable provider (Twilio recommended); update cron/reminder logic
- **Stripe integration** — replace Razorpay with Stripe for US billing; subscription webhooks, plan upgrade/downgrade
- **Locale / timezone** — ensure date formatting, week-start day, and timezone handling work for US gyms
- **Compliance** — review data residency requirements; consider US Supabase region

### AI Upsell Layer — Monthly Coach Reports (Manage Pro)

**Pricing gate:** `ai_reports_enabled` flag on `companies`. Enables a Manage Pro tier (target ₹5,500/month vs ₹4,000 Standard). Super admin toggles per company.

**What it does:** On the 1st of each month, a Vercel Cron job runs per active company with `ai_reports_enabled = true`, pulls data, generates a plain-English business intelligence report via Claude Haiku, and emails it to the company_admin.

**Report sections:**

1. **Member health** — total active, new this month, expiring in 30 days, lapsed (expired + not renewed), churn vs prior month
2. **Revenue signals** — this month collections (sum of `memberships.amount_paid` where `start_date` in current month), renewal value due in next 30 days, at-risk MRR (expiring members with no upcoming renewal)
3. **Engagement** *(only if `client_module_enabled`)* — sessions logged this month vs last, clients silent for 14+ days (no `logged_sessions` entry), average sessions per PT client, top 3 most active clients
4. **AI narrative** — Claude Haiku generates a 4–6 sentence plain-English summary tying the numbers together: what's healthy, what needs attention, one suggested action. `max_tokens: 300`. Business type always passed as context (same pattern as plan generation).
5. **Program suggestions** *(only if `client_module_enabled`)* — for PT clients with 6+ weeks of logged sessions whose `weekly_plans` hasn't been updated in 3+ weeks, flag them by name as "ready for plan refresh". No AI call needed — pure query logic.

**Implementation checklist:**
- [ ] Add `ai_reports_enabled boolean default false` to `companies` in Supabase
- [ ] Add super admin toggle in `app/admin/page.tsx` (same pattern as other flags)
- [ ] Add email provider — **Resend** (resend.com): free tier 3,000 emails/month, $20/mo beyond; integrates cleanly with Next.js API routes via `npm install resend`; add `RESEND_API_KEY` env var
- [ ] Create `app/api/generate-monthly-report/route.ts` — takes `company_id`, runs all queries, calls Haiku, sends email via Resend
- [ ] Add Vercel Cron in `vercel.json`: `{ "crons": [{ "path": "/api/cron/monthly-reports", "schedule": "0 6 1 * *" }] }` — runs 6am on 1st of each month
- [ ] Create `app/api/cron/monthly-reports/route.ts` — fetches all companies with `ai_reports_enabled = true`, calls generate-monthly-report for each
- [ ] Secure cron route with `CRON_SECRET` header check (Vercel passes this automatically on Pro)

**Key queries needed:**
- New members: `profiles` where `created_at >= first of month` and `company_id` and `archived_at IS NULL`
- Expiring soon: `memberships` where `end_date` between today and +30 days, latest per profile
- At-risk MRR: expiring members × their `amount_paid` with no future membership row
- Silent PT clients: `profiles` where `client_type = 'pt'` and no `logged_sessions` row in last 14 days
- Plan stale: `profiles` pt clients where latest `weekly_plans.created_at` older than 21 days

**Email format:** Plain HTML, mobile-readable. Not a PDF. Subject: `"Your CoachBoard Monthly Report — [Month] [Year]"`. From: `reports@getcoachboard.in`.

**Shared cron infrastructure with SMS reminders** — the daily SMS cron (sprint item 1) and this monthly cron share the same pattern; build SMS cron first, this slots in naturally alongside it.

### Infrastructure (future)
- **Razorpay integration** — subscription webhooks, plan upgrade/downgrade, billing page; required to scale past 3-4 paying customers
- **Supabase Storage** — buckets for progress photos and workout plan PDFs with RLS (clients see only their own files)
- **Supabase RLS** — in place (see Known Issues → RLS status)

---

## Known Issues / Tech Debt

**RLS status (hardened 30 Oct 2026, `db/2026-10-30-rls-hardening.md`; history in `db/2026-10-25-rls-remaining.md`).** RLS is ON for every table. Each company-owned table has exactly four rules, `iso <table> <action>`; cross-company test passed 117 / 117 on production. Who can do what from the browser:
- `companies`: members read their own row; super admin reads / creates / edits / deletes all; the owner may update their row, and trigger `protect_company_columns` limits that to `logo_url` / `banner_url`. Logged out (`anon`): the branded login page calls `rpc('get_company_branding', { p_slug })` (security definer, one gym's `name, slug, logo_url, banner_url, business_type, banner_has_branding`; `db/2026-10-31-company-branding-rpc.md`). The old open rule "Public can read company branding" (`USING (true)`) was dropped 31 Oct (that file's Step 2): logged out, `companies` returns 0 rows, so never read it logged out.
- `profiles`: everyone reads and updates their own row; staff read their gym and update its **clients**; coaches read their gym's PT clients and coaches (owner / partner names via `rpc('gym_staff')`); super admin all. **Only the server creates profiles**; only super admin deletes from the browser (partner removal). Trigger `protect_profile_columns` locks `role` / `company_id`, and for clients + coaches `client_type`, `archived_at`, `primary_coach_id`.
- `memberships`: staff of the gym (the profile must be in the same gym), clients read their own, super admin all; coaches nothing (plan + dates only via `pt_membership_status()`).
- `weekly_plans`, `logged_sessions`: staff of the client's gym; coaches for PT clients (no deletes); clients read their own and log their own sessions (`logged_by` empty or themselves); `weekly_plan_id` must belong to the same client.
- `session_feedback`: staff of the gym; coaches read PT clients'; clients read their own and add a star rating only (no `admin_feedback`, no edit / delete).
- `branches`, `batches` (#77, `db/2026-11-03-branches-batches.md`, `db/2026-11-03-branches-super-admin.md`): everyone signed in to the gym reads; **branches: only super admin adds / edits** (pricing per branch); **batches: owner / partner add and edit their gym's** (the branch must be in the same gym); super admin all; no delete (archive).
- `attendance` (#78, `db/2026-11-03-attendance.md`): owner / partner / coach read and mark their gym's (the batch and the student must be in the gym; a coach only PT students; `marked_by` = the person saving); a student reads their own; super admin all; no delete (untap = `present false`).
- `leads`: staff of the gym read / add / update, super admin reads all, no delete. `ai_usage`, `contact_requests`: super admin read (server writes).
- `exercise_logs` (#80, `db/2026-11-05-exercise-logs.md`): client reads / edits own; owner / partner their gym's (read, add, edit, delete); coach their gym's PT clients' (read, add, edit, no delete); super admin all. Every write checks the session belongs to `client_id`, the client is in `company_id`, and `exercise_id` is the starter list or that gym's; `logged_by` = the person saving.
- `exercises` (#74, `db/2026-11-01-exercise-library.md`): everyone signed in reads the starter list + their gym's; owner / partner / coach add and edit their gym's; starter list super admin only; no delete (archive).
- `session_metrics` (not used by the app yet): same reach as `logged_sessions` — client own sessions, staff their gym's client sessions, coaches their gym's PT client sessions (no delete), super admin all (`db/2026-10-31-session-metrics-rls.md`, run on Mumbai 31 Oct). `client_goals`: RLS on, no rules, not used — locked on purpose.
- API routes and `proxy.ts` use the server key, so RLS doesn't affect them; every route checks the caller with `getCaller()`. Blocked updates / deletes return 0 rows without an error: use `.select()` after update / delete and check rows when it matters.

**RLS rules (company isolation, 30 Oct 2026).** Follow these for every table and policy:
- **Helpers:** `get_my_role()` and `get_my_company_id()` — `stable security definer set search_path = public`, reading `profiles` where `id = auth.uid()`. Always call them as `(select public.get_my_role())` so they run once per query, not per row.
- **Scoping pattern:** every company-owned row is visible / writable only when `company_id = (select public.get_my_company_id())`, or the caller is `super_admin`. INSERT and UPDATE repeat the scope in `WITH CHECK` so nobody can write or move a row into another company. Child tables without `company_id` go through the parent: `exists (select 1 from profiles p where p.id = client_id and p.company_id = (select public.get_my_company_id()))` (`session_feedback` goes through `logged_sessions` then `profiles`). A row that points at another row (e.g. `memberships.profile_id`, `logged_sessions.weekly_plan_id`) must also check that row is in the same company / client.
- **Roles:** staff (`company_admin`, `partner`) = full access to their company. `coach` = their company's PT clients, plans and sessions only; never `memberships` (amounts), `leads` or company settings; staff names come from `rpc('gym_staff')` (id, name, role, archived only), never from owner / partner profile rows (`lib/gym-staff.ts`). `client` = own profile, plans, sessions, star ratings. Profiles are created only by the server (`create-user`).
- **Every new table needs RLS on and all four policies (select, insert, update, delete) in the same transaction**, named `iso <table> <action>`, plus an explicit `GRANT` to `authenticated` (never to `anon`; logged-out users get only the five branding columns of `companies`). A missing policy shows up as a save that silently does nothing.
- Test with the cross-company script (kept outside the public repo); it creates two throwaway gyms, checks every role, and rolls everything back.

**Auth is client-side only.** The proxy (`proxy.ts`) runs SSR auth and role checks but pages also do their own `useEffect → getUser() → redirect`. Not a security hole (the proxy handles it) but the redundant client-side checks could be cleaned up.

**No server components.** Every page is `'use client'`. All Supabase queries run in the browser. Fine for now; reconsider when SEO or initial load performance matters.

**Phone login convention (login identifier rule, #75).** Phone logins are Supabase Auth emails built **only** by `loginEmailFor(country, localDigits)` in `lib/phone.ts` — never inline:
- India (+91) → `9876543210@getcoachboard.in` (unchanged, no migration of existing users)
- every other country → full digits with the country code: `971501234567@getcoachboard.in` (UAE), `15551234567@getcoachboard.in` (US / Canada)
- Digits: IN 10, AE 9, US 10, CA 10. `isPhoneLogin(email)` tells phone logins from real emails.
- **Clients:** `loginMethod(country)` (lib/locale.ts) is `'phone'` only for India; clients from anywhere else log in with email. A client's country = the gym's, or their own in a multi-country gym.
- **Clients without a login (2 Nov):** a login is optional. With no email (and, for India, no valid 10-digit phone) the member is added without one: the coach enters everything and shares progress. `create-user` (`no_login: true`) gives them a placeholder Auth user `client-<uuid>@nologin.getcoachboard.in` with a random password nobody knows (`NO_LOGIN_DOMAIN`, `isNoLogin`, `shownEmail` in lib/phone.ts); screens show "No login", never the placeholder, and hide Reset Password. Not a phone login, so `update-client` never moves it. Owner / partners give them a login later from the client page → ⋯ → **Create login** (username + password, `/api/create-login`: changes that same Auth user's email / password and `profiles.email`; only for `isNoLogin` clients, real logins use Reset password).
- **Client usernames (9 Nov):** every **new** client login, in every country, is a username + password; the phone is contact / WhatsApp only (new clients never get a phone login). Outside India an email login is still offered when no username is given; in India the Add form has no email field. Existing phone and email logins are unchanged and keep working. A username is stored as `<username>@user.getcoachboard.in` (`USERNAME_DOMAIN`, `usernameEmail`, `usernameOf`, `isUsernameLogin`); **unique across all gyms**, guaranteed by Supabase Auth's unique email (`create-user` / `create-login` also check first and return 409 + free suggestions, `lib/username-server.ts`). Rules in `usernameProblem` (3–20 chars, a–z 0–9 . - _, starts / ends with a letter or number, at least one letter, no @, reserved words). The login page tells the three apart with `loginInputKind` (@ = email, a letter = username, else phone). Not a phone login (`update-client` never moves it), not shown as an email (`shownEmail` = ''); screens show "Username anand.k". Username box with live check and suggestions: `app/username-field.tsx` → `/api/check-username` (staff). Check: `scripts/check-username.ts`.
- **Staff** (`staffLogin` in lib/phone.ts): India phone (password = number). Other countries: email + password, or with no email the phone + country code (password = number). Existing US staff keep their email logins.
This is load-bearing — `update-client` (Indian numbers only) and `update-coach` sync the auth email when the phone changes. `scripts/check-phone.ts` fails if a page builds `@getcoachboard.in` inline.

**Admin client instantiated ad-hoc.** `SUPABASE_SECRET_KEY` is used inline in each API route. No shared helper. Follow the same pattern when adding new privileged routes.

**`branch_id` not yet added.** Partner logins are built but branch-level filtering is not. `branch_id uuid nullable` needs to be added to `profiles` in Supabase before that ships.

---

## Smoke tests

Playwright smoke tests (`e2e/smoke.spec.ts`, shared fixture `e2e/fixtures.ts`, config `playwright.config.ts`, ROADMAP #81) open the live app on a phone-sized Chromium (Pixel 7) and check that each role's home and key pages load: home page, login, wrong password, logged-out guard, branded login, unknown gym, owner / partner / coach / solo coach / dojo owner / sensei, wrong gym's address, super admin (local only). GitHub Action `.github/workflows/smoke.yml` runs them after every successful Production deploy (Vercel `deployment_status`), daily at 07:30 IST, and by hand (Actions → Smoke tests → Run workflow). The HTML report is uploaded as an artifact (14 days), with screenshot, video and trace for failures.

- **QA companies (prod and dev, same phones):** QA Gym (`qagym`), the QA solo coach (`qasolo`) and the QA dojo (`qadojo`), marked as test accounts (TEST badge). Their seeded records (QA Active, QA Expired, QA PT, QA Lead, QA Solo Client, QA Student, QA Daily) are what the tests look for: **never edit, archive or delete them**, and never use the QA companies for demos. Dev setting: QA Solo's client limit is **2** (regression test R13 relies on it).
- **Logins:** `QA_LOGINS` = JSON `{"gymOwner":{"id":"<phone or email>","password":"…"}, "gymPartner":…, "gymCoach":…, "soloOwner":…, "dojoOwner":…, "dojoSensei":…}` (the id may also be called `phone` / `email` / `identifier` / `login` / `username`, or give a pair `["<id>","<password>"]`). GitHub secret `QA_LOGINS` for the Action; locally in `.env.e2e` (ignored by git, like every `.env*`) with `E2E_BASE_URL`. `SUPERADMIN_ID` / `SUPERADMIN_PASSWORD` go only in your local `.env.e2e` (test S16), **never in the workflow**.
- **Write guard:** the fixture lets through only GET / HEAD / OPTIONS, POST to `/rest/v1/rpc/*` (read-only RPCs) and `/auth/v1/*` (login); every other request to `/rest/v1`, `/api` or `/storage/v1` is aborted and the test fails listing method + URL. Smoke tests must never write to Mumbai; a page that writes just by being opened fails here. The fixture also fails on any console error / uncaught exception (known noise goes in `CONSOLE_ALLOW_LIST`, empty), any 5xx, and 401 / 403 from `rest/v1` (RLS / auth break).
- **Run locally:** `npm run dev`, then `E2E_BASE_URL=http://localhost:3000` (gym addresses become `qagym.localhost:3000`, `lib/tenant.ts`) and `npm run test:smoke`; `npm run test:smoke:report` opens the report. Against production: `E2E_BASE_URL=https://www.getcoachboard.com`. First time: `npx playwright install chromium`.
- **Rule for new work:** every new page puts a `data-testid="page-…"` on an element that renders only after its data has loaded (not the skeleton), and a new feature that is visible on load adds a smoke check. Only S3 and S15 are failed logins; keep it that way (Supabase login rate limit). Tests use `data-testid`s, and text only for seeded QA names.

## Conventions

**Routing by role:** `/dashboard/page.tsx` reads the role and redirects. `partner` → `/company`, `coach` → `/coach`. `proxy.ts` enforces which roles may open each section (`/admin` super_admin; `/coach` coach; `/company/client` company_admin + partner + coach, listed before `/company` because the first match wins; `/company/attendance` company_admin + partner + coach (also before `/company`); `/company` incl. `/company/leads`, `/company/exercises` and `/company/batches` company_admin + partner; `/client` client) and sends anyone else to their own home. A turned-off coach is sent to `/login?off=coach`. Keep that table in `proxy.ts` up to date when adding sections.

**Gym subdomains:** `<slug>.getcoachboard.com` runs the whole app for that company (Vercel wildcard domain `*.getcoachboard.com`). `proxy.ts` runs on every page (not `/api` or static files): only `PROTECTED` pages need a login; on a subdomain it also sends an unknown gym to the main site, `/` to `/dashboard`, and a login from another gym (not super admin) to `/login?off=gym`. The login page reads the gym from the address (`lib/tenant.ts`), else `?company=<slug>`, else the gym of the last login on that device (`localStorage` key `coachboard-gym`, saved after a successful non-super-admin login, kept after logout, so apps installed from getcoachboard.com stay branded), and refuses another gym's login on a gym's address. On phones the gym's banner, logo (or first letter), name and tagline sit across the top. Logins are per address (cookies aren't shared between the subdomain and getcoachboard.com). Keep redirects relative (same address); a redirect to another host needs an explicit `Location` header. Local dev: `syedfitness.localhost:3000`. Next.js 16 uses `proxy.ts` (the old `middleware.ts` name is deprecated).

**Dev / prod setup (10–11 Nov 2026):** two Supabase projects, both in Mumbai:

| Project | Ref | Use | SQL Editor |
|---|---|---|---|
| coachboard-mumbai | `nptxjfvkqjuekgkspemu` | **Prod**, the live app (`main`, getcoachboard.com) | `https://supabase.com/dashboard/project/nptxjfvkqjuekgkspemu/sql/new` |
| coachboard-dev | `nnxrmaiinbmxfwzefbwx` | **Dev** (`dev` branch, Vercel Preview + Development, local `.env.local`) | `https://supabase.com/dashboard/project/nnxrmaiinbmxfwzefbwx/sql/new` |

The old Tokyo project `rzndxzhmgxkxihnwqnoy` was deleted on 10 Nov; never refer to it in new files. Vercel: Production env vars = Mumbai, Preview + Development = dev. Dev link (always the latest `dev` build): **https://getcoachboard-git-dev-craraos-projects.vercel.app** (gym logins `/login/qagym`, `/login/qasolo`, `/login/qadojo`). Dev has the same QA companies (QA Gym, QA Solo, QA Dojo, same phones as prod QA), created through the UI; no real gym data is ever copied to dev.
- **Git workflow:** branch off `dev` → merge into `dev` → test on the dev link (phone) → merge `dev` into `main` = prod. **Claude works off `dev`**: new branches start from `origin/dev` and PRs target `dev`. **Never push to, merge into or open a PR against `main` unless Anand says so in the conversation.** Never suggest "Promote to Production" on a `dev` / branch build in Vercel.
- **Database changes:** dev's schema is a copy of prod's public schema (rebuild steps in Anand's notes, backups kept outside the repo). Keep them in step: every SQL change is run on **dev first**, tested on the dev link, **then on Mumbai** when it ships to `main`. Storage buckets, the starter exercise list (`supabase/seed_exercises.sql`) and Auth settings live outside the public schema and are set up by hand in each project.
- `psql` is blocked for Claude Code: Anand runs SQL by hand in the SQL Editor (or psql on his machine).

**SQL files (`db/*.md`, migrations) — which Supabase project:** every new SQL file starts with two lines, in this order: "1. Run in: **Dev** — project `nnxrmaiinbmxfwzefbwx`" with the dev SQL Editor link, then "2. After testing on the dev link, run in: **Mumbai (prod)** — project `nptxjfvkqjuekgkspemu`" with the Mumbai link, and asks to check the project ref in the address bar before running. Say at the end of the file which project(s) it has been run in (and when). On 31 Oct SQL was run in the wrong project by mistake and uploads kept failing: when a rule "looks right" but the app disagrees, first check which project it was run in. Older files that only name Mumbai were run on Mumbai only; dev already has their result (it was copied from Mumbai on 10 Nov).

**Styling:** Tailwind CSS 4 utility classes inline. No separate CSS files. No CSS modules.

**AI calls:** Claude Haiku via `@anthropic-ai/sdk`. Plans use `max_tokens: 300` (heading-only format). Insights use `max_tokens: 200`. Business type always passed as context.

**Component structure:** Pages are monolithic `'use client'` files. No shared component library. Build inline per page. Exceptions, shared because several pages need the same control: `app/country-code-picker.tsx` (first shared component, #75), `app/username-field.tsx`, plus the plan builder pieces (`app/plan-editor.tsx`, `app/exercise-picker.tsx`, `app/plan-copy-sheet.tsx`, `app/plan-days.tsx`, `app/session-form.tsx`).

**Country & dates:** Never hard-code `'en-IN'`, `'en'`, `toLocaleDateString()` or `new Date('YYYY-MM-DD')` for display. Use `lib/locale.ts` (`formatDate(value, country, style)`, `loginMethod`, `dialCode`, `phonePlaceholder`) with the company's `country`. Date-only DB values must go through `parseDate`/`formatDate` so they don't shift a day in US timezones. Money uses `lib/currency.ts`.

**Multi-country & currencies (#75, `db/2026-11-01-multi-country.md`):** every amount is shown in its own row's currency (`memberships.currency`, falling back to the gym's `currency` for rows read before the SQL). Totals are added up per currency with `groupByCurrency` and shown as "₹48,000 · AED 3,200" only when more than one currency has amounts; a single-currency gym sees exactly the old figures (incl. % vs last month and trend bars). Never add amounts of different currencies together. Multi-country off ⇒ no new fields anywhere. Pickers offer only `allowed_currencies`; a currency removed later stays on saved rows and still displays. Renew carries the latest membership's currency forward (changeable in multi-country gyms); Correct never sends a currency. New columns are only sent once they exist (`'allowed_currencies' in company`), and memberships are read with `select('*')` so the app works before and after the SQL. Phones: read stored phones with `splitE164` / `displayPhone` / `waDigits` (both `+91…` and old 10-digit values work); WhatsApp links are India / US numbers only.

**Company type (#60, `db/2026-10-30-company-type.md`):** `companies.company_type` is `gym` (default) or `coach` (an individual coach: one person). Always gate with `isGym(company)` / `isCoachCompany(company)` from `lib/company-type.ts`, never string comparisons; missing values count as `gym`. A `coach` company hides the Coaches section, Coach assignments / Coach activity cards, the primary-coach picker (Add member + client Profile tab), coach names on client cards, "by Coach X" / "covering" labels and the super admin's partner limit / Add partner. Leads, members, memberships, payments, plans, sessions and progress PDF stay. The server enforces it too: `create-user` refuses `coach` / `partner` logins, `set-coach-active` refuses turning a coach back on, and `update-client` refuses setting a primary coach. Switching a gym to `coach` deletes nothing: existing coach / partner logins stay (coaches can be turned off; partners removed by super admin). Separate from `business_type` and from #42 (in-gym vs online mode). Pages read the company with `companies(*)` so the column is picked up without breaking before its SQL ran.

**Business type & dojo wording (#53, Dojo Build 1):** `companies.business_type` is set by super admin (Create / Edit company). A dojo is Company type `gym` + Business type `martial_arts`; every other business type keeps today's wording exactly. Visible words for clients go through `memberWord(businessType)` in `lib/labels.ts` (Student / Students for martial arts, else Member / Members): **never hard-code "Member" in new UI**, and never rename columns, routes, types or variables for it. Gate dojo behaviour with `isDojo()`, not string comparisons. **Dojo Build 1.1:** coach logins are called Sensei / Senseis (`staffWord()`; the role, `/coach` route and variables keep their names), and every dojo student is a PT client (`create-user` saves `client_type = 'pt'` for martial arts; no PT checkbox, badge or "PT" counts for dojos; `ptWord()` = "students"), so senseis see every student and progress can be shared with parents. Dojos also hide the Exercise list link, the diet plan (Add form, Profile tab, AI diet chart) and the fitness fields: the dojo Profile tab is Age, Gender, Medical Conditions / Injuries, Parent / guardian and the primary sensei (hidden fields keep their saved values). Super admin: leave a dojo's PT limit empty (or = client limit). **Dojo Build 1.2 (no Plans):** dojos have no Plans tab (Profile · Sessions · Progress; saved plans are kept, attendance with batches replaces plans later). Staff log a session without a plan from the Sessions tab or the "Log today's session" bar (`handleCoachLogDay(null, …)`, `weekly_plan_id` empty); plan links (`?tab=plans`) open Sessions, `?tab=sessions&log=today` opens the form. The sensei home is a "Came today / Not yet" list (rows open Log session, no plan text or "no plans" note); the owner Training card hides plan progress, missed days and "No plan this week". `lib/coach-today.ts` labels take the staff word and the coach logins' ids (`todayRows` / `beforeYouStart` / `loggedByLabel`). **Who logged a session (all gyms):** only coach / sensei logins read "by Coach Ravi" / "by Sensei Ravi"; a session logged by the owner or a partner shows their first name ("by Anand"). The Add Student form takes Age, Gender and Medical conditions for dojos (one screen; `create-user` accepts `age`, `gender`, `medical_conditions` for clients).

**Branches & batches (#77, Dojo Build 2, `db/2026-11-03-branches-batches.md`):** martial arts only for now (the tables work for any gym; gym multi-branch #20 can switch them on). **Branches are added / renamed / archived by super admin only** (pricing is per branch; Super Admin → Companies → Edit → Branches, `app/branches-editor.tsx`; rule `db/2026-11-03-branches-super-admin.md`). Owner / partners see the branches and add / edit / archive the **batches** inside them on `/company/batches`. Archive, never delete. A student has a branch and a home batch (`profiles.branch_id` / `batch_id`), picked on Add Student or the Profile tab; picking a batch sets its branch; they can attend any batch (attendance: #78). `create-user` / `update-client` check both with `lib/placement-server.ts` (same gym, batch at the branch, not newly picking an archived one). Dashboard: branch chips (the list and its tab counts follow), home batch under each name; sensei home shows it too. Everything stays hidden until the tables exist (the pages ask for `branches` / `batches` once; an error = not yet). Labels come from `lib/batches.ts` (`batchWhen`, `homeBatchLine`, `daysLabel`, `timeRange`).

**Attendance (#78, Dojo Build 3, `db/2026-11-03-attendance.md`):** for dojos, attendance replaces Log session once the table exists (pages ask for `attendance` once; an error = not yet, then Build 1.2 behaviour). Roll call `/company/attendance/<batch id>[?date=]` (proxy: owner, partner, coach): tap who came, tap again to undo (`present false`), not tapped = absent, "+ Drop-in" for students of other batches (`is_drop_in`), past days correctable, no future days; saves with `upsert(onConflict: 'batch_id,profile_id,class_date')`. Monthly view `/company/attendance`. Counts come from `lib/attendance.ts`: `monthStats` = days attended (any batch, one per day) vs the home batch's scheduled classes so far, counted **from the day the student joined** (`profiles.created_at`); `buildAttendanceMessage` is the parent's WhatsApp (same `pickRecipient` rule). Student page: Sessions tab is "Attendance", Progress shows classes this / last month, Share = attendance month (no PDF). Sensei home: Today's batches across branches + came today from attendance. Owner dashboard: Attendance card replaces the session-based Training and Sensei activity cards. Old logged sessions stay and still show. **Same student in two batches on one day is allowed** (exams, extra classes; no unique rule on `(profile_id, class_date)`): the roll call reads the whole day's rows and warns "Already came today · <batch> · by <who>" and asks before a second mark (`cameElsewhere`, `elsewhereText`). `/company/attendance/today` (static route, before `[batchId]`) is the day as a table grouped by batch (`dayBoard`; `came` counts each student once).

**Parent / guardian (#53, `db/2026-11-03-guardian.md`):** any client can have a parent (`guardian_name / guardian_phone / guardian_relation`); the Add Member "Child — add parent details" box starts ticked only for martial arts. Fields show and are sent only once the columns exist (dashboard: one `select('guardian_phone').limit(1)` probe; client page: `'guardian_phone' in client`). Who a WhatsApp message goes to is one rule, `pickRecipient` in `lib/guardian.ts` (parent when their phone is valid, else the client), used by progress shares and membership reminders (`reminderRecipient` + `reminderText`; no parent = the old wording and number). `create-user` and `update-client` validate the parent phone on the server. The parent's phone is contact only, never a login. **Fee reminder (dojos):** on the owner / partner dashboard a dojo student's row shows a green "Send reminder" instead of Remind when the fee (latest membership end date) is due today or within 7 days, an amount is saved and the parent phone is a WhatsApp number: a wa.me link to the parent with the Namaste message (`feeReminder` in `lib/guardian.ts`). Overdue, 8+ days or no parent phone → the row's usual button. With `companies.upi_id` set (super admin, Companies → Edit → UPI ID; `db/2026-11-07-upi-id.md`, checked by `upiProblem`) the message adds the two UPI lines; empty = no UPI lines.

**Weight / reps per exercise (#80, `db/2026-11-05-exercise-logs.md`):** v1 is the coach path only (client page → Plans → this week's day). A ticked exercise shows sets × reps @ kg, pre-filled by `prefill(e, lastLogFor(...))`; changed numbers are kept on the device under `coach-weights:<planId>:<Day>` like the ticks. `handleCoachLogDay` saves the session first, then the rows from `rowsToSave` (timed / distance and empty exercises left out; `exercise_id` via `resolveExerciseId`, so it is always the starter list or the gym's); if that insert fails the session stays and `weightsRetry` retries the weights only. The page asks for `exercise_logs` once with the sessions; an error = table missing, weight rows hidden. Progress tab chart: Weeks (Monday weeks, `weekOf`) / Months toggle via `progressBy`. Progress PDF: `strengthReport(logs, library, upTo)` (logs up to the report week's Sunday) drawn after the weekly charts; the day-by-day plan only when "Include the week's plan" is on (localStorage `pdf-include-plan`, default on); **no calories in the PDF** (`showCalories` off, `withoutCalories` on the printed message; WhatsApp keeps them). kg only in the UI; never add kg and lb. Delete cascade order for a client is unchanged (logs go with the session).

**Generated child logins (`lib/phone.ts`):** a child added with no phone of their own gets `generatedStudentLogin()` = `student-<8 a–z / 0–9>@getcoachboard.in` and a random 16-character password (made in `create-user`), `profiles.phone` null, so siblings can share a parent's phone. `isGeneratedLogin()` spots them; they are not phone logins (`isPhoneLogin` false, so `update-client` never moves them) and count as "no login" (`isNoLogin`, `shownEmail`). Never shown anywhere; Super Admin shows "No login (child)". The phone-login rule for everyone else is unchanged.

**Today's schedule (`/company/today[?date=]`, rules in `lib/today-schedule.ts`):** read-only day view for owner / partners (proxy: `/company`), linked from the dashboard above the Training card when the Train module is on and the gym has PT clients. Gyms and individual coaches (`isCoachCompany`: titled "My day", no coach names, coach filter or "covered by"); never dojos (they use Attendance → All of today). Data: PT clients (not archived, latest membership not ended before the day; no membership = kept), plans that started in the 6 days up to the day, that day's `logged_sessions`, staff via `loadGymStaff` — 5 reads in parallel, nothing added to the dashboard's own load. **Workout time is per plan** (`weekly_plans.workout_time`, text: `18:30` from the time picker or older free text, read with `timeMinutes`), so one time for the plan's whole week. Expected = the plan covering the day (`planCovering`) has a workout day on it (or is an undatable "Day 1, Day 2…" plan); rest day / no plan = not expected. Status: a session that day = **Trained** (newest session names the logger, `loggedByLabel`; amber "covered by X" when staff other than the client's primary coach logged it); else past day = **Not logged**, future = **Expected**, today = Not logged once `GRACE_MINUTES` (60) passed after the workout time, else Expected (no readable time = Expected). Bottom sections: "Also trained" (trained on a rest day / with no plan) and "No time set" (expected with no readable time, then no plan this week). Coach filter = clients whose primary coach is that person plus anyone they logged that day; "No coach" chip for clients without one. Today / now = device time (IST for Indian gyms), like the rest of the app.

**Belt grading (Phase 1, `supabase/migrations/20261110120000_belt_grading.sql`, run on Mumbai 10 Nov; dev has the tables too, copied from Mumbai, confirmed 11 Nov. Dev has no `dsska`, so no dev gym has belts or Grading on until they are added for QA Dojo):** gated by `companies.grading_enabled` (`gradingOn()` in `lib/belts.ts`; on for DSSKA). **Current belt + history rule:** `profiles.current_rank_id` / `rank_achieved_on` hold the CURRENT belt (fast for lists); `student_grades` is the history log, and every change of `current_rank_id` appends a row, written only by the server (`create-user` / `update-client`, `lib/belts-server.ts`): Add Student = `joined` (default White, belt since = the membership start date), first belt set later = `backfill`, a change = `manual`; the same belt with a corrected date fixes `achieved_on` on its latest row. A set belt can be changed, not cleared; existing students without one show "Belt not set" (never auto-assigned). Phase 1 UI is only the Belt + "Belt since" fields on Add Student and the student's Profile tab (Edit, owner / partner; read-only line for everyone else). Labels: `beltLabel` ("White", "Yellow – 8th kyu"). No chips, exams or results yet (Phase 2). Check: `scripts/check-belts.ts`. RLS: `belt_ranks` / `grading_exams` readable by the whole gym; `student_grades` / `grading_exam_candidates` by staff (incl. coaches) and the student themselves; writes owner / partner (+ super admin).

**Membership latest record:** Always sort by `start_date DESC`, take index `[0]`. This is the active plan.

**Archived clients:** Always filter `archived_at IS NULL` when fetching active clients. Both `fetchClients` in `company/page.tsx` and the `client_limit` count check do this. Do not forget this filter if adding new queries over `profiles`.

**Delete cascade order:** session_feedback → logged_sessions → weekly_plans → memberships → profiles → auth user. Always in this order to avoid FK violations.

**Hosting region & offline cache:** `vercel.json` pins server functions (API routes, `proxy.ts`) to Mumbai `bom1`, next to the Supabase project (moved from Tokyo `hnd1`, ROADMAP #48). `public/sw.js` caches only content-hashed static files and icons; pages and data always come from the network. Bump the `CACHE` name in `sw.js` when its caching rules change.

**Environment variables:**
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — browser client
- `SUPABASE_SECRET_KEY` — server/admin client (API routes only, never expose to browser)
- `ANTHROPIC_API_KEY` — AI features (API routes only)

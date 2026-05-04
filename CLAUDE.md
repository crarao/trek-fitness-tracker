@AGENTS.md

# CoachBoard — Session Reference

## Project Overview

Multi-tenant fitness coaching SaaS (white-labeled as "CoachBoard"). Companies sign up, add clients, assign AI-generated workout plans, and track progress. Originally trek-focused; now supports gym, pilates, yoga, cycling, and general coaching.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth) · Tailwind CSS 4 · Chart.js · Anthropic Claude Haiku (AI plans + insights) · Vercel (hosting)

**Stage:** Active development. Core flows fully working. First customer trial underway as of April 2026. Code pushed to GitHub main and deployed on Vercel.

---

## User Roles

Roles are stored in `profiles.role`. Login always goes through `/login`, then redirects by role.

### `super_admin` → `/admin`
Platform owner (Anand). Manages all companies: create, edit, activate/deactivate, set `client_limit` and `pt_limit`, toggle per-company feature flags (`feedback_enabled`, `ai_insights_enabled`, `session_notes_enabled`, `client_module_enabled`), manage subscription status, add/remove partner logins per company.

### `company_admin` → `/company`, `/company/client/[id]`
Coach/org admin scoped to their own company. Creates and manages clients (up to `client_limit`), assigns AI-generated weekly plans (Claude Haiku, business-type-aware), reviews session logs, provides written feedback on sessions. Sees subscription countdown banner when account is near expiry.

### `partner` → `/company`
Staff login for a gym (receptionist, branch manager). Same dashboard view as `company_admin`. Added by super_admin per company. Default password = phone number. Future: will be scoped to a branch via `branch_id` when branch filtering ships.

### `client` → `/client`
End user. Logs workout sessions, views assigned weekly plans, tracks progress via charts (activities/week, minutes/week, day streak), requests AI coaching insights. Feature visibility is controlled by per-company feature flags.

---

## Data Model

```
companies
  ├── name, email, phone, logo_url
  ├── is_active, is_trial, trial_end
  ├── client_limit, pt_limit
  ├── feedback_enabled, ai_insights_enabled, session_notes_enabled
  ├── client_module_enabled
  └── business_type (gym | trek | pilates | yoga | cycling | general)

profiles (one per user, linked to a company)
  ├── role (super_admin | company_admin | partner | client)
  ├── company_id → companies
  ├── client_type (member | pt)       ← PT = personal training client
  ├── archived_at (timestamptz null)  ← null = active, set = archived
  ├── full_name, email, phone
  └── fitness fields: goal, age, gender, height_cm, weight_kg,
      fitness_level, food_preference, available_days,
      medical_conditions, emergency_contact_name/phone,
      trainer_name, diet_plan

memberships (one row per plan period, multiple per profile)
  ├── profile_id → profiles
  ├── company_id → companies
  ├── plan_type (1 Month | 3 Months | 6 Months | 1 Year)
  ├── amount_paid
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
```

**Membership history is preserved.** Every renewal inserts a new `memberships` row. `Correct Current` updates the latest row (for typos only). Latest membership = `ORDER BY start_date DESC LIMIT 1`.

**Archive convention.** `archived_at IS NULL` = active client. Setting `archived_at` hides the client from the dashboard, member list, and `client_limit` count. Renewing a membership auto-clears `archived_at`.

---

## Key Files

| Concern | File |
|---|---|
| Supabase browser client | `lib/supabase.ts` |
| Supabase admin client | Instantiated inline in each API route (no shared helper) |
| Auth + role routing | `app/login/page.tsx`, `app/dashboard/page.tsx` |
| Middleware (SSR auth) | `middleware.ts` |
| Super admin UI | `app/admin/page.tsx` |
| Company admin dashboard | `app/company/page.tsx` |
| Client detail (coach view) | `app/company/client/[id]/page.tsx` |
| Client app | `app/client/page.tsx` |
| API: create user | `app/api/create-user/route.ts` |
| API: delete user | `app/api/delete-user/route.ts` |
| API: delete company | `app/api/delete-company/route.ts` |
| API: update client | `app/api/update-client/route.ts` |
| API: AI plan generation | `app/api/generate-plan/route.ts` |
| API: AI coaching insights | `app/api/ai-insights/route.ts` |
| API: password reset | `app/api/reset-password/route.ts` |

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
- **Supabase RLS** — row-level security not yet configured; all scoping is application-logic only; fix before scaling

---

## Known Issues / Tech Debt

**No RLS.** Row-level security in Supabase is not configured. All access scoping is in application logic only. Risk: a user who knows another `company_id` could query cross-company data from the browser. Fix before scaling.

**Auth is client-side only.** Middleware runs SSR auth checks but pages also do their own `useEffect → getUser() → redirect`. Not a security hole (middleware handles it) but the redundant client-side checks could be cleaned up.

**No server components.** Every page is `'use client'`. All Supabase queries run in the browser. Fine for now; reconsider when SEO or initial load performance matters.

**Phone login convention.** Phone number logins are stored as `{10-digit-phone}@getcoachboard.in` in Supabase Auth. This is load-bearing — `update-client` API syncs the auth email when a phone number changes. Do not change the email format without a migration.

**Admin client instantiated ad-hoc.** `SUPABASE_SECRET_KEY` is used inline in each API route. No shared helper. Follow the same pattern when adding new privileged routes.

**`branch_id` not yet added.** Partner logins are built but branch-level filtering is not. `branch_id uuid nullable` needs to be added to `profiles` in Supabase before that ships.

---

## Conventions

**Routing by role:** `/dashboard/page.tsx` reads the role and redirects. `partner` → `/company`. Do not add role checks in middleware beyond what's already there.

**Styling:** Tailwind CSS 4 utility classes inline. No separate CSS files. No CSS modules.

**AI calls:** Claude Haiku via `@anthropic-ai/sdk`. Plans use `max_tokens: 300` (heading-only format). Insights use `max_tokens: 200`. Business type always passed as context.

**Component structure:** Pages are monolithic `'use client'` files. No shared component library. Build inline per page.

**Membership latest record:** Always sort by `start_date DESC`, take index `[0]`. This is the active plan.

**Archived clients:** Always filter `archived_at IS NULL` when fetching active clients. Both `fetchClients` in `company/page.tsx` and the `client_limit` count check do this. Do not forget this filter if adding new queries over `profiles`.

**Delete cascade order:** session_feedback → logged_sessions → weekly_plans → memberships → profiles → auth user. Always in this order to avoid FK violations.

**Environment variables:**
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — browser client
- `SUPABASE_SECRET_KEY` — server/admin client (API routes only, never expose to browser)
- `ANTHROPIC_API_KEY` — AI features (API routes only)

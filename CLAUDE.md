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

**Stage:** Active development. Core flows fully working. First customer trial underway as of April 2026. Code pushed to GitHub main and deployed on Vercel.

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
Gym coach. Added by the owner or a partner from the dashboard's Coaches section (no limit, not counted in `client_limit`); turned off with `archived_at` + an auth ban via `/api/set-coach-active`, never deleted. `/coach` is today's training list (who is expected today, done or not; no missed / follow-up prompts). Sees **all PT clients** of the gym plus staff names: opens any PT client, sees plans, sessions, progress and the "Before you start" card, marks done, logs sessions, creates and edits plans (AI cap applies; `generate-plan` and `ai-plan-usage` allow `PLAN_ROLES`). Can't see payments / amounts, revenue, leads or settings, can't add / edit / archive / delete members, change the primary coach, give feedback (reads it) or delete plans. Membership only as plan and dates from `rpc('pt_membership_status')`: **never query `memberships` as a coach**. Every other API route is `STAFF` only and returns 403 to coaches.

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
  ├── country (IN | US, default IN)   ← drives currency, date format, client login method
  ├── currency (INR | USD)            ← set from country by super admin
  ├── business_type (gym | trek | pilates | yoga | cycling | general)
  ├── company_type (gym | coach, default gym) ← super admin only; 'coach' = individual coach (#60), see lib/company-type.ts
  └── slug (unique, nullable)          ← super admin sets it; gym address <slug>.getcoachboard.com (lib/tenant.ts) and login link /login/<slug> (→ /login?company=<slug>). Rules in lib/company-slug.ts, DB guard db/2026-10-31-company-slug.md

profiles (one per user, linked to a company)
  ├── role (super_admin | company_admin | partner | client | coach)
  ├── company_id → companies
  ├── client_type (member | pt)       ← PT = personal training client
  ├── archived_at (timestamptz null)  ← null = active, set = archived (for a coach: login turned off)
  ├── primary_coach_id → profiles     ← client's coach, picked from a dropdown (PT: primary coach; regular member: optional trainer). Soft link, never limits access; owner/partner set it. trainer_name = old free-text field, read-only now
  ├── full_name, email, phone
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
| Leads rules (sources, follow-up state, WhatsApp wording, summary) | `lib/leads.ts` |
| Client app | `app/client/page.tsx` |
| Coach home (today's training list) | `app/coach/page.tsx` |
| Coach rules (today's rows, Before you start, covering) | `lib/coach-today.ts` (check: `scripts/check-coach-today.ts`) |
| Company type helpers (`isGym`, `isCoachCompany`, `companyType`) | `lib/company-type.ts` |
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
- `companies`: members read their own row; super admin reads / creates / edits / deletes all; the owner may update their row, and trigger `protect_company_columns` limits that to `logo_url` / `banner_url`. Logged out (`anon`): only `name, slug, logo_url, banner_url, business_type` (column grant, for the branded login page).
- `profiles`: everyone reads and updates their own row; staff read their gym and update its **clients**; coaches read their gym's PT clients and coaches (owner / partner names via `rpc('gym_staff')`); super admin all. **Only the server creates profiles**; only super admin deletes from the browser (partner removal). Trigger `protect_profile_columns` locks `role` / `company_id`, and for clients + coaches `client_type`, `archived_at`, `primary_coach_id`.
- `memberships`: staff of the gym (the profile must be in the same gym), clients read their own, super admin all; coaches nothing (plan + dates only via `pt_membership_status()`).
- `weekly_plans`, `logged_sessions`: staff of the client's gym; coaches for PT clients (no deletes); clients read their own and log their own sessions (`logged_by` empty or themselves); `weekly_plan_id` must belong to the same client.
- `session_feedback`: staff of the gym; coaches read PT clients'; clients read their own and add a star rating only (no `admin_feedback`, no edit / delete).
- `leads`: staff of the gym read / add / update, super admin reads all, no delete. `ai_usage`, `contact_requests`: super admin read (server writes).
- API routes and `proxy.ts` use the server key, so RLS doesn't affect them; every route checks the caller with `getCaller()`. Blocked updates / deletes return 0 rows without an error: use `.select()` after update / delete and check rows when it matters.

**RLS rules (company isolation, 30 Oct 2026).** Follow these for every table and policy:
- **Helpers:** `get_my_role()` and `get_my_company_id()` — `stable security definer set search_path = public`, reading `profiles` where `id = auth.uid()`. Always call them as `(select public.get_my_role())` so they run once per query, not per row.
- **Scoping pattern:** every company-owned row is visible / writable only when `company_id = (select public.get_my_company_id())`, or the caller is `super_admin`. INSERT and UPDATE repeat the scope in `WITH CHECK` so nobody can write or move a row into another company. Child tables without `company_id` go through the parent: `exists (select 1 from profiles p where p.id = client_id and p.company_id = (select public.get_my_company_id()))` (`session_feedback` goes through `logged_sessions` then `profiles`). A row that points at another row (e.g. `memberships.profile_id`, `logged_sessions.weekly_plan_id`) must also check that row is in the same company / client.
- **Roles:** staff (`company_admin`, `partner`) = full access to their company. `coach` = their company's PT clients, plans and sessions only; never `memberships` (amounts), `leads` or company settings; staff names come from `rpc('gym_staff')` (id, name, role, archived only), never from owner / partner profile rows (`lib/gym-staff.ts`). `client` = own profile, plans, sessions, star ratings. Profiles are created only by the server (`create-user`).
- **Every new table needs RLS on and all four policies (select, insert, update, delete) in the same transaction**, named `iso <table> <action>`, plus an explicit `GRANT` to `authenticated` (never to `anon`; logged-out users get only the five branding columns of `companies`). A missing policy shows up as a save that silently does nothing.
- Test with the cross-company script (kept outside the public repo); it creates two throwaway gyms, checks every role, and rolls everything back.

**Auth is client-side only.** The proxy (`proxy.ts`) runs SSR auth and role checks but pages also do their own `useEffect → getUser() → redirect`. Not a security hole (the proxy handles it) but the redundant client-side checks could be cleaned up.

**No server components.** Every page is `'use client'`. All Supabase queries run in the browser. Fine for now; reconsider when SEO or initial load performance matters.

**Phone login convention.** Phone number logins are stored as `{10-digit-phone}@getcoachboard.in` in Supabase Auth. This is load-bearing — `update-client` API syncs the auth email when a phone number changes. Do not change the email format without a migration.

**Admin client instantiated ad-hoc.** `SUPABASE_SECRET_KEY` is used inline in each API route. No shared helper. Follow the same pattern when adding new privileged routes.

**`branch_id` not yet added.** Partner logins are built but branch-level filtering is not. `branch_id uuid nullable` needs to be added to `profiles` in Supabase before that ships.

---

## Conventions

**Routing by role:** `/dashboard/page.tsx` reads the role and redirects. `partner` → `/company`, `coach` → `/coach`. `proxy.ts` enforces which roles may open each section (`/admin` super_admin; `/coach` coach; `/company/client` company_admin + partner + coach, listed before `/company` because the first match wins; `/company` incl. `/company/leads` company_admin + partner; `/client` client) and sends anyone else to their own home. A turned-off coach is sent to `/login?off=coach`. Keep that table in `proxy.ts` up to date when adding sections.

**Gym subdomains:** `<slug>.getcoachboard.com` runs the whole app for that company (Vercel wildcard domain `*.getcoachboard.com`). `proxy.ts` runs on every page (not `/api` or static files): only `PROTECTED` pages need a login; on a subdomain it also sends an unknown gym to the main site, `/` to `/dashboard`, and a login from another gym (not super admin) to `/login?off=gym`. The login page reads the gym from the address (`lib/tenant.ts`), else `?company=<slug>`, else the gym of the last login on that device (`localStorage` key `coachboard-gym`, saved after a successful non-super-admin login, kept after logout, so apps installed from getcoachboard.com stay branded), and refuses another gym's login on a gym's address. On phones the gym's banner, logo (or first letter), name and tagline sit across the top. Logins are per address (cookies aren't shared between the subdomain and getcoachboard.com). Keep redirects relative (same address); a redirect to another host needs an explicit `Location` header. Local dev: `syedfitness.localhost:3000`. Next.js 16 uses `proxy.ts` (the old `middleware.ts` name is deprecated).

**Styling:** Tailwind CSS 4 utility classes inline. No separate CSS files. No CSS modules.

**AI calls:** Claude Haiku via `@anthropic-ai/sdk`. Plans use `max_tokens: 300` (heading-only format). Insights use `max_tokens: 200`. Business type always passed as context.

**Component structure:** Pages are monolithic `'use client'` files. No shared component library. Build inline per page.

**Country & dates:** Never hard-code `'en-IN'`, `'en'`, `toLocaleDateString()` or `new Date('YYYY-MM-DD')` for display. Use `lib/locale.ts` (`formatDate(value, country, style)`, `loginMethod`, `dialCode`, `phonePlaceholder`) with the company's `country`. Date-only DB values must go through `parseDate`/`formatDate` so they don't shift a day in US timezones. Money uses `lib/currency.ts`.

**Company type (#60, `db/2026-10-30-company-type.md`):** `companies.company_type` is `gym` (default) or `coach` (an individual coach: one person). Always gate with `isGym(company)` / `isCoachCompany(company)` from `lib/company-type.ts`, never string comparisons; missing values count as `gym`. A `coach` company hides the Coaches section, Coach assignments / Coach activity cards, the primary-coach picker (Add member + client Profile tab), coach names on client cards, "by Coach X" / "covering" labels and the super admin's partner limit / Add partner. Leads, members, memberships, payments, plans, sessions and progress PDF stay. The server enforces it too: `create-user` refuses `coach` / `partner` logins, `set-coach-active` refuses turning a coach back on, and `update-client` refuses setting a primary coach. Switching a gym to `coach` deletes nothing: existing coach / partner logins stay (coaches can be turned off; partners removed by super admin). Separate from `business_type` and from #42 (in-gym vs online mode). Pages read the company with `companies(*)` so the column is picked up without breaking before its SQL ran.

**Membership latest record:** Always sort by `start_date DESC`, take index `[0]`. This is the active plan.

**Archived clients:** Always filter `archived_at IS NULL` when fetching active clients. Both `fetchClients` in `company/page.tsx` and the `client_limit` count check do this. Do not forget this filter if adding new queries over `profiles`.

**Delete cascade order:** session_feedback → logged_sessions → weekly_plans → memberships → profiles → auth user. Always in this order to avoid FK violations.

**Hosting region & offline cache:** `vercel.json` pins server functions (API routes, `proxy.ts`) to Mumbai `bom1`, next to the Supabase project (moved from Tokyo `hnd1`, ROADMAP #48). `public/sw.js` caches only content-hashed static files and icons; pages and data always come from the network. Bump the `CACHE` name in `sw.js` when its caching rules change.

**Environment variables:**
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — browser client
- `SUPABASE_SECRET_KEY` — server/admin client (API routes only, never expose to browser)
- `ANTHROPIC_API_KEY` — AI features (API routes only)

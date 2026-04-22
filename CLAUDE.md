@AGENTS.md

# Trek / CoachBoard — Session Reference

## Project Overview

Multi-tenant fitness coaching SaaS (white-labeled as "CoachBoard"). Companies sign up, add clients, assign AI-generated workout plans, and track progress. Originally trek-focused; now supports gym, pilates, yoga, cycling, and general coaching.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres + Auth) · Tailwind CSS 4 · Chart.js · Anthropic Claude Haiku (AI plans + insights) · Vercel (hosting)

**Stage:** Active development. Core flows are working; subscription logic recently replaced trial logic.

---

## User Roles

Roles are stored in `profiles.role`. Login always goes through `/login`, then redirects by role.

### `super_admin` → `/admin`
Platform owner. Manages all companies: create, edit, activate/deactivate, set `client_limit`, toggle per-company feature flags, manage trial/subscription status. Only role with a cross-company view.

### `company_admin` → `/company`, `/company/client/[id]`
Coach/org admin scoped to their own company. Creates and manages clients (up to `client_limit`), assigns AI-generated weekly plans (Claude Haiku, business-type-aware), reviews session logs, provides written feedback on sessions. Sees a subscription countdown banner when account is near expiry.

### `client` → `/client`
End user. Logs workout sessions, views assigned weekly plans, tracks progress via charts (activities/week, minutes/week, day streak), requests AI coaching insights. Feature visibility (feedback, AI insights, session notes) is controlled by per-company feature flags.

---

## Data Hierarchy

```
companies
└── profiles (role, company_id, all fitness/health fields)
      ├── weekly_plans (week_start, plan_details, workout_time)
      └── logged_sessions (session_date, duration_minutes, notes, weekly_plan_id)
            └── session_feedback (star_rating, admin_feedback)
```

**Per-company feature flags** (columns on `companies`):
- `feedback_enabled` — coach can add feedback to sessions
- `ai_insights_enabled` — clients can request AI insights
- `session_notes_enabled` — clients can add notes when logging
- `client_limit` — max clients allowed
- `is_active` / `is_trial` / `trial_end` — subscription state

---

## Key Files

| Concern | File(s) |
|---|---|
| Supabase client (browser) | `lib/supabase.ts` |
| Supabase admin client | Instantiated inline in API routes |
| Auth + role routing | `app/login/page.tsx`, `app/dashboard/page.tsx` |
| Middleware (currently no-op) | `middleware.ts` |
| Super admin UI | `app/admin/page.tsx` |
| Company admin UI | `app/company/page.tsx` |
| Client detail (company view) | `app/company/client/[id]/page.tsx` |
| Client UI | `app/client/page.tsx` |
| API: create user | `app/api/create-user/route.ts` |
| API: AI plan generation | `app/api/generate-plan/route.ts` |
| API: AI coaching insights | `app/api/ai-insights/route.ts` |
| API: password reset | `app/api/reset-password/route.ts` |

`/src` is a legacy directory — ignore it. All active code is in `/app`.

---

## Known Issues / Tech Debt

**Auth is client-side only.** `middleware.ts` returns `NextResponse.next()` with an empty matcher — no server-side route protection. Each page guards itself with `useEffect → getUser() → redirect`. Until this is fixed, unauthenticated requests can technically reach page components before the redirect fires. Fix: use Supabase SSR helpers in middleware.

**No server components.** Every page is `'use client'`. There are no React Server Components or `server-only` data fetches. All Supabase queries run in the browser.

**Phone login convention.** Phone number logins are converted to `{10-digit-phone}@getcoachboard.in` and authenticated as email+password. This is load-bearing — don't change the email format without a migration.

**Admin client instantiated ad-hoc.** `SUPABASE_SECRET_KEY` is used inline in each API route rather than from a shared helper. If you add a new privileged route, follow the same pattern.

**No RLS confirmed.** Row-level security in Supabase is not explicitly configured in the codebase. Access scoping is enforced in application logic only.

---

## Conventions

**Routing by role:** `/dashboard/page.tsx` reads the role and pushes to the right route. Don't add role checks in middleware until the no-op is resolved intentionally.

**Styling:** Tailwind CSS 4 utility classes inline. No separate CSS files. No CSS modules.

**AI calls:** Claude Haiku via `@anthropic-ai/sdk`. Plans use `max_tokens: 2000`; insights use `max_tokens: 200`. Business type (gym / trek / pilates / yoga / cycling / general) is passed as context.

**Component structure:** Pages are monolithic `use client` files. There is no shared component library yet — UI is mostly built inline per page.

**Environment variables:**
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — browser client
- `SUPABASE_SECRET_KEY` — server/admin client (API routes only)
- `ANTHROPIC_API_KEY` — AI features

# CoachBoard Roadmap

The working priority list. Claude ticks items off here as they ship (PR number in brackets).
Numbers stay fixed so they can be referred to in chat ("do #11").

_Last updated: 24 Oct 2026_

---

## ✅ Done

- [x] **#2 Protect the AI plan route** — extended to all 7 API routes: every route checks who is calling (login, role, same gym). `lib/auth-server.ts` (#7)
- [x] **#5 Assign Plan fix** — clear buttons, one panel at a time, saves that really save, errors shown, separate AI draft, US date fix (#3)
- [x] **#6 Confirmation messages** — big centred messages after assign / update / delete, later extended to all coach and super admin actions (#4, #6, #9)
- [x] **#7 AI "working" panel** — spinner, seconds counter, Cancel, 60 s timeout, clear errors with Try again (#4)
- [x] **#8 Country on company (IN / US)** — `companies.country` drives date format, currency, WhatsApp code; US clients log in with email; date line under every date picker (#5, #6)
- [x] **#9 Login hint in Add Member** (#1)
- [x] **#10 US coach's company and sample clients** — done manually by Anand
- [x] **#23 Landing page for getcoachboard.com** — public home page, no pricing, contact form saved to `contact_requests` and shown in /admin → Requests, share preview card (#8)
- [x] **Super admin fixes** — in-app confirm box for delete, Create Company validates before saving (no orphan/duplicate companies), client/PT limit boxes fixed, reset password for company admin and partners, phone-friendly company list (#6, #9)
- [x] **#1 (part) RLS critical fixes** — run in Supabase 24 Oct: `memberships` RLS on with 3 rules (staff own gym, clients own, super admin all); trigger `protect_profile_columns` stops anyone but super admin / server changing `role` or `company_id`. Undo: `alter table public.memberships disable row level security; alter table public.profiles disable trigger protect_profile_columns;`
- [x] **#24 Plans tab polish** — clearer buttons, week defaults to Monday, panels scroll into view, new card highlighted, missing-profile note (#15)
- [x] **#29 Compact plan cards** — coach Plans tab: week + This week / Upcoming / Past badge, "3 workout days · 18 exercises", day chips, tap to expand, ✏️ 🗑 icons, 6 shown + Show older; client screen opens on this week's plan with Show / Hide full plan (#17). Summary read from plan text (`lib/plan-summary.ts`) until #14 adds structured plans.
- [x] **#28 Membership renew fix** — Edit opens in Renew mode with dates starting after the current membership (or today); separate Correct mode; saves checked with red errors; same-day tie goes to the newest entry (#16)
- [x] **#4 Role check at the door** — `middleware.ts` renamed to `proxy.ts` (Next 16); each section only opens for the right role, others go to their own home (#14)
- [x] **#3 `.claude/settings.local.json` no longer tracked** — approved by Anand; added to `.gitignore` (#13)
- [x] **No-deletion rule for Claude** — CLAUDE.md Rule #1 + `.claude/settings.json` deny list (#2)

---

## P0 — Security (before more real customers)

- [ ] **#1 RLS: remaining rules** — RLS was already on for most tables (audit 24 Oct). Done so far: `memberships` closed and role/company lock on profiles (see Done). Still to fix:
  - Any member of a gym (incl. clients) can update their company row: trial end, client limit, active status. Restrict to company admin + protect billing columns.
  - Clients can read every profile in their gym (phones, medical conditions). Clients should see only themselves; staff their gym.
  - Logged-out visitors can read all companies (incl. internal notes, emails) via "Anyone can read company branding". Limit to what the login page needs.
  - Partners are missing from weekly_plans / logged_sessions / session_feedback rules (staff can't assign plans).
  - `client_goals` has RLS on but no rules (probably unused).
  - Do with an undo script per change, at the computer, then test as super admin, coach, partner and client.

## P2 — Speed (phone app feels slow)

- [ ] **#11 Client View page speed-up** (22 Oct Task 5) — `app/company/client/[id]/page.tsx`
  - Run profile, memberships, weekly_plans, logged_sessions queries in parallel (`Promise.all`); fetch feedback via a join in the sessions query.
  - Select only needed columns instead of `*`.
  - After a save, refetch only what changed instead of the full `initialize()`.
  - Move Progress charts into `ProgressCharts.tsx` loaded with `next/dynamic` (also for `app/client/page.tsx`).
  - Skeleton loading instead of "Loading…".
- [ ] **#12 Owner home page speed-up** (22 Oct Task 6) — `app/company/page.tsx`
  - `getSession()` instead of `getUser()` at the top (the proxy already verifies).
  - Merge profile + company lookup into one query; start `fetchClients` straight after.
  - Load archived clients only when that tab is opened.
  - Select only needed columns; skeleton rows.
- [ ] **#13 Service worker rewrite + region** (22 Oct Task 7)
  - `public/sw.js`: cache name `coachboard-v2`; `/_next/static`, icons, fonts cache-first; pages network-only with offline fallback to `/login`; never cache logged-in pages; keep skipping Supabase and `/api/`.
  - Manual step for Anand: Vercel → Project Settings → Functions → region Tokyo (`hnd1`), next to Supabase.

## P3 — Product upgrade (replaces 22 Oct Task 8, compact plan cards)

- [ ] **#14 Structured weekly plan** — AI returns days and exercises as JSON (new `plan_json` column); coach sees 7 expandable day rows.
- [ ] **#15 Client day-by-day logging** — tap a day, then Done or feedback (new `plan_day` column on `logged_sessions`).
- [ ] **#16 Calorie estimate on each Done** — weight × duration × the day's effort level.
- [ ] **#17 Adherence stat for owners** — "3 of 4 days done".

## P4 — Next features

- [ ] **#18 Indian diet chart** from structured fields (veg / non-veg, region, goal, allergies).
- [ ] **#19 SMS reminders** — MSG91 + DLT registration (takes 5–7 days, start the paperwork early). US: Twilio.
- [ ] **#20 Multi-branch** — `branch_id`, owner dashboard across branches, coach assignment.

## Later (after #1 and a consent flow)

- [ ] **#21 Medical report upload** feeding into the diet chart.
- [ ] **#22 Subdomain branding** (gymname.getcoachboard.com).

---

## Small follow-ups noted along the way

- [ ] **#25 US partner logins use email** — partners added in super admin still log in by phone (`{phone}@getcoachboard.in`); fine for India, US partners should use email like US clients.
- [ ] **#26 Email alert for contact form requests** — needs a sending address (admin@getcoachboard.com via Zoho Mail / Namecheap Private Email) and an email provider (e.g. Resend).
- [ ] **#27 Fresh demo video** — the YouTube demo is from April; a new 60-second recording would show today's app (could go on the landing page).

## Manual to-dos for Anand (not code)

- [ ] Set up admin@getcoachboard.com (forwarding is free; a real mailbox is ~$1/user/month).
- [ ] Delete the duplicate "New US company" (Usc@gmail.com) that has no admin login.
- [ ] Add testimonials to `app/landing-content.ts` (or send them to Claude) when you get them.

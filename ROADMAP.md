# CoachBoard Roadmap

The working priority list. Claude ticks items off here as they ship (PR number in brackets).
Numbers stay fixed so they can be referred to in chat ("do #11").

_Last updated: 25 Oct 2026 (evening)_

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
- [x] **#1 RLS remaining rules** — run in Supabase 25 Oct from `db/2026-10-25-rls-remaining.md`, steps 1–5 all tested: partners can manage plans/sessions/feedback; only the coach can update the gym row and only the logo/banner (trigger `protect_company_columns`); clients read only their own profile, staff their gym, super admin all; clients can't change their PT flag / archive status; logged-out visitors read only company name/slug/logo/banner/business type; only staff can delete plans and feedback. Undo for each step is in the script. (#20)
- [x] **#1 (part) RLS critical fixes** — run in Supabase 24 Oct: `memberships` RLS on with 3 rules (staff own gym, clients own, super admin all); trigger `protect_profile_columns` stops anyone but super admin / server changing `role` or `company_id`. Undo: `alter table public.memberships disable row level security; alter table public.profiles disable trigger protect_profile_columns;`
- [x] **#24 Plans tab polish** — clearer buttons, week defaults to Monday, panels scroll into view, new card highlighted, missing-profile note (#15)
- [x] **#11 Client page speed-up** — data loads in parallel (sessions + feedback in one request), saves refresh only what changed, charts load only on Progress (`app/progress-charts.tsx` via `next/dynamic`, also on the client screen), skeleton while loading (#22)
- [x] **#12 Owner dashboard speed-up** — local session instead of a network check, profile + company in one request, members start loading immediately, archived members load only when that tab opens (count shown from a light query), skeleton rows (#22)
- [x] **#13 Service worker rewrite + region** — `public/sw.js` v2: content-hashed files/icons cache-first, pages network-only with offline login fallback, logged-in pages never cached, old v1 cache cleared; `vercel.json` sets server functions (API routes, proxy) to Tokyo `hnd1`, next to Supabase (#23)
- [x] **#31 Tap feedback on all buttons** — every button/link presses in and brightens when tapped, no double-tap delay on phones; thin orange loading bar at the top for Back, Logout, member rows and links to other pages (`app/nav-progress.tsx`, `app/globals.css`) (#24)
- [x] **#30 Tap feedback on member rows** — tapped row highlights with "Opening…" and a spinner, other rows dim, page prefetches on touch (#22)
- [x] **#29 Compact plan cards** — coach Plans tab: week + This week / Upcoming / Past badge, "3 workout days · 18 exercises", day chips, tap to expand, ✏️ 🗑 icons, 6 shown + Show older; client screen opens on this week's plan with Show / Hide full plan (#17). Summary read from plan text (`lib/plan-summary.ts`) until #14 adds structured plans.
- [x] **#28 Membership renew fix** — Edit opens in Renew mode with dates starting after the current membership (or today); separate Correct mode; saves checked with red errors; same-day tie goes to the newest entry (#16)
- [x] **#4 Role check at the door** — `middleware.ts` renamed to `proxy.ts` (Next 16); each section only opens for the right role, others go to their own home (#14)
- [x] **#3 `.claude/settings.local.json` no longer tracked** — approved by Anand; added to `.gitignore` (#13)
- [x] **No-deletion rule for Claude** — CLAUDE.md Rule #1 + `.claude/settings.json` deny list (#2)

---

## P0 — Security (before more real customers)

## P2 — Speed (phone app feels slow)


## P3 — Product upgrade (replaces 22 Oct Task 8, compact plan cards)

- [x] **#14 Structured weekly plan** — AI fills a fixed form (7 days → exercises with sets, reps, rest, note), saved in `weekly_plans.plan_json` (SQL in `db/2026-10-25-plan-json.md`) with a text copy in `plan_details`; coach and client see 7 day rows (tap for exercises), client ticks off the day inside its row, today's workout opens first; day-by-day editor for AI drafts, new plans and edits (Workout / Rest per day, add / move / remove exercises), paste-as-text with "Convert to days", older text plans can be converted (#26, #27). Shared code: `lib/plan-structure.ts`, `app/plan-days.tsx`, `app/plan-editor.tsx`.
- [x] **#15 Client day-by-day logging** — light version (#25): tap a day → Done ✓ with minutes, date, feel, notes, saved with `logged_sessions.plan_day`. Full version (PR #32): on this week's structured plan the client ticks exercises inside the day row as they go (kept on the phone during the workout); on Done ✓ the ticks are saved with the session (`logged_sessions.exercises_done`) and the coach sees "6 of 7 exercises" on the Sessions tab and the ticks on the plan card. SQL from `db/2026-10-25-exercises-done.md` run 25 Oct, so ticks are now saved.
- [x] **#16 Calorie estimate** — "~260 kcal (estimate)" from effort level (read from the day's focus, else the gym's business type) × client weight × minutes; client sees it on the Done message, done days, Activity History and "Calories this week" on Progress; coach sees it on each session and this week / last week on Progress. Nothing stored, no SQL (`lib/calories.ts`) (#28)
- [x] **#17 Adherence for owners and coaches** — owner dashboard "Training this week" card (PT clients: % and days done of planned, last 4 weeks %, tappable "Most days left" and "No plan this week" names) and "2/4 wk" on PT member rows; coach → client → Progress shows this week and last 4 weeks. Rule in `lib/adherence.ts`. No SQL (#31)
- [ ] **#32 Activity type on the Log tab** — discussed 25 Oct; SQL column added 25 Oct, ready to build. Sessions logged outside the plan have no "what was done". Plan: one SQL line (`alter table public.logged_sessions add column if not exists activity text;`); required "What did you do?" tap buttons on the Log tab (Gym / Weights, Walk, Run, Cycling, Yoga, Pilates, Swim, Trek / Hike, Sport, Other — Sport / Other ask for a name, e.g. Badminton); calorie estimate uses the activity's effort level (Walk 3.5, Run 9, Swim 7, Sport 6…); shown in the client's Activity History and the coach's Sessions tab; older sessions unchanged. Plan-day ticks don't need it (the day's focus says what was done).

## P4 — Next features

- [ ] **#18 Diet chart** — generic version shipped (#19): AI diet chart from food preference (incl. Jain / Vegan), meals per day, goal, weight/height; India vs US foods by company country; coach reviews and saves to the diet plan. **Still to add:** region / cuisine and allergies / foods to avoid fields (allergies after the remaining RLS rules in #1).
- [ ] **#19 SMS reminders** — MSG91 + DLT registration (takes 5–7 days, start the paperwork early). US: Twilio.
- [ ] **#20 Multi-branch** — `branch_id`, owner dashboard across branches, coach assignment.

## Later (after #1 and a consent flow)

- [ ] **#21 Medical report upload** feeding into the diet chart.
- [ ] **#22 Subdomain branding** (gymname.getcoachboard.com).

---

## Small follow-ups noted along the way

- [x] **#25 US partner logins use email** — super admin → company → Partner Logins follows the company's country: US partners get name + email (login) + password + optional phone; India unchanged (phone login, password = phone); partner list shows the login (#30)
- [x] **#33 New company showed "trial expired" until edited** — reported 25 Oct. Cause: Create Company showed the trial date boxes but didn't save them, and the coach dashboard treated "no end date" as expired. Fixed: Create saves trial start / end with `is_trial` and `is_active`, checks end ≥ start; default dates are local (not UTC); end date counts as the last full day everywhere (`daysUntil` / `localDateIso` in `lib/locale.ts`); no end date = no warning (#34)
- [ ] **#26 Email alert for contact form requests** — needs a sending address (admin@getcoachboard.com via Zoho Mail / Namecheap Private Email) and an email provider (e.g. Resend).
- [ ] **#27 Fresh demo video** — the YouTube demo is from April; a new 60-second recording would show today's app (could go on the landing page).

## Manual to-dos for Anand (not code)

- [x] **Run 2 SQL lines in Supabase (at a computer)** — done by Anand 25 Oct; both only add empty columns:
  `alter table public.logged_sessions add column if not exists exercises_done jsonb;` (saves exercise ticks so coaches see them, #15)
  `alter table public.logged_sessions add column if not exists activity text;` (needed before #32 activity type is built)
- [ ] Set up admin@getcoachboard.com (forwarding is free; a real mailbox is ~$1/user/month).
- [x] Delete the duplicate "New US company" (Usc@gmail.com) that has no admin login. (done 25 Oct)
- [ ] Add testimonials to `app/landing-content.ts` (or send them to Claude) when you get them.

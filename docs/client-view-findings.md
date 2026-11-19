# Client view: findings (Task 0, 19 Nov 2026)

What I found for `claude/coachboard-client-view-nov19.md`. No code changed. The draft SQL is in
`db/2026-11-19-client-view.md` (**not run**).

**Prerequisite:** the 17 Nov sets build is merged into `dev` (PR #140 `sets-exercises`, then #141, #144,
#145). `setsOf()` is in `lib/exercise-logs.ts`, `findExercise()` in `lib/exercises.ts`, and
`exercise_logs.exercise_id` is written by `rowsToSave` → `resolveExerciseId`.

**Table names.** The brief says "sessions", "plans" and "logged exercises". In this repo they are
`logged_sessions`, `weekly_plans` and `exercise_logs`. Everything below uses the real names.

---

## ⚠️ Points for Anand to decide before Part B / C (details in each section)

1. **The brief's gym defaults would lock out today's gym clients.** `client_login` = false and
   `client_can_log_sessions` = false for gyms would, the moment Part B ships, turn off the client app for
   every existing gym client who uses it now, because every company starts with `client_settings = '{}'`.
   **My proposal:** a key that isn't stored means *what the app does today* (client login on, logging on). The
   brief's defaults are then written into `client_settings` when Super Admin creates a new company, or
   during the setup consultation. The other choice is to back-fill every existing company first. **Which one?**
2. **There are no client API routes.** Every client write (sessions, star ratings, profile, goal) goes straight
   from the browser to Supabase (`app/client/page.tsx`). "Refused on the server when the switch is off" therefore
   has to be **RLS**: the SQL file adds `client_setting(key)` and restrictive policies for the client role.
3. **Clients can't update any session today** (`iso logged_sessions update` has no client branch). B5 "Add a
   note" to a session a coach logged, and C (editing your own session), both need a rule change. I propose a
   new `logged_sessions.client_note` column. A client may change only that column on a coach-logged session,
   and only their own sessions in full (self-training). **OK?**
4. **Clients can already edit exercise logs the coach saved.** `iso exercise_logs update` lets a client change
   any of their own rows, whoever logged them. That conflicts with B5 ("coach-logged is read-only for the
   client"). The client app never does this today. I propose tightening it so a client can only change rows
   where `logged_by` is themselves or empty. That is an `alter policy`, not a drop. **OK?**
5. **Plans don't record who made them.** `weekly_plans` has no `created_by`. I propose
   `created_by uuid default auth.uid()`: empty means made by staff or older. A self-training plan is
   `created_by = client_id`, so no extra plan type column is needed.
6. **The coach note in the monthly report:** v1 is not stored (typed, then printed on the PDF and in
   WhatsApp). If you want a history of notes, that needs a table, which isn't drafted. **OK as not stored?**

---

## 1. "Strength by exercise" (coach Progress tab)

- **File:** `app/exercise-progress.tsx` (`ExerciseProgressChart`). It is loaded with `next/dynamic` from
  `app/company/client/[id]/page.tsx:45` and drawn at `:3728` when `exerciseLogsOn`. The owner, partner
  and coach all use this one page, so Part A has one place to wire up.
- **Data:** `datedLogs` = every `exercise_logs` row of the client (`EXERCISE_LOG_COLUMNS`, which includes
  `set_details`) plus its session's `session_date`. The library is the gym's exercises plus the starter list.
- **Heaviest weight per week:** `progressBy(logs, library, 'week')` in `lib/exercise-logs.ts`:
  - It groups by `progressKey`, which is `exercise_id`, else `findExercise(…, {close:false})`, else `nameKey`.
  - Each log goes to its Monday week (`weekOf`).
  - The week's point is the heaviest set over all its logs (`heaviestSet` on `setsOf(l)`, ties go to more reps).
  - Volume is `setsVolume` summed over the week (Σ kg × reps).
  - The chart shows the last 8 Monday weeks (`lastWeeks`). The chips list the 8 exercises with the most logs.
- **The header line** ("10 kg × 10 · volume 300 kg · no change to show yet"):
  - `latestPoint` is the newest *week with a weight* among the 8 shown. For the example that is 2 Nov:
    3 × 10 @ 10 kg, so 10 kg × 10 and volume 3 × 10 × 10 = 300.
  - The change part is `changeThisPeriod(sel, current)`, and `current = periodOf(today)`, **the calendar week
    of today**.
- **Why it says "no change" when the chart shows 15 → 10 kg:** `changeThisPeriod` returns `null` when the
  *current* week has no weight. Today's week (16 Nov) has no log, so the header falls back to "no change to show
  yet", even though the two weeks it is drawing (26 Oct = 15 kg, 2 Nov = 10 kg) differ by −5 kg.
  - The header only ever shows a change during the same calendar week as a log. Then it compares with the
    previous logged week, not with the first in the range, and as a %.
  - The chips have the same bug (they also use `changeThisPeriod` with today's week).
  - The header describes "this week". The chart describes the last 8 weeks.
  - **Fix (A4):** latest best set · its volume · change = latest point vs the *first point in the range*, in kg.
    This is the same number as the list row.
- **Chart problems to fix in A4** (`axis.y.beginAtZero: false`, `spanGaps: true`, `fill: true`, `tension: 0.3`):
  - The y-axis hugs the data, so 15 → 10 fills the whole chart.
  - Empty weeks are bridged by a line and the area fill.
- `lastMonths` / `weekOf` / `topWeightSeries` / `withWeightIn` / `strengthReport` already live in
  `lib/exercise-logs.ts`. A5's `lib/progress.ts` can re-export and add to them instead of moving code (Rule #1).

## 2. What a client login sees today (`app/client/page.tsx`, 1105 lines, one file, no children except shared forms)

**Gate:** if `companies.client_module_enabled` is off, the client gets a simple membership card (plan, dates,
days left) and nothing else. Otherwise there are four tabs:

| Tab | Shows | Writes |
|---|---|---|
| **My Plan** | Goal card; plan picker (all `weekly_plans`, newest first); this week's structured plan day by day with exercise ticks (ticks kept on the phone, `cb-ticks`); "Done ✓" per day; "Logged by your coach" on days a coach logged | `profiles.goal` (update); `logged_sessions` insert via `handleLogDay` (date, minutes, notes, `plan_day`, `exercises_done`, plan link through `linkForDate`); `session_feedback` insert (star rating only) |
| **Log** | "Log an activity" form (`app/session-form.tsx`): activity type (`lib/activities.ts`), minutes, date, notes (if `session_notes_enabled`), optional plan link | `logged_sessions` insert via `handleLogSession` (no `plan_day`); `session_feedback` star |
| **Progress** | Activities / Minutes / Day streak tiles; calories since Monday; AI insights (if `ai_insights_enabled`, calls `/api/ai-insights`); activities/week and minutes/week charts (`app/progress-charts.tsx`, 8 weeks); session list with coach feedback (if `feedback_enabled`) and "by coach" | none (AI insights is a read on the server) |
| **Profile** | Fitness profile form; change password | `profiles` update (fitness fields only; `protect_profile_columns` blocks role / company / client_type / archive / primary coach); `supabase.auth.updateUser` |

- The client app **never reads or writes `exercise_logs`**, so there are no weights or sets on the client side.
  The client's plan-day "Done ✓" saves `exercises_done` (names ticked), not weights.
- Client inserts don't send `logged_by` (it stays null = "logged by the client"). `byCoach(s)` is
  `logged_by && logged_by !== me`.
- There is no duplicate check. A client can mark a day done that the coach already logged.

## 3. PT vs non-PT

- The column is `profiles.client_type`, `'pt' | 'member'`. `create-user` saves `client_type || 'member'`, and
  every dojo student gets `'pt'`. Clients and coaches can't change it (`protect_profile_columns`).
- Coaches see PT clients only. RLS `p.client_type = 'pt'` is on `weekly_plans`, `logged_sessions`,
  `exercise_logs` and `profiles`, plus `app/coach/page.tsx:72` and `lib/coach-today.ts:95`. The owner's
  Today schedule (`lib/today-schedule.ts`) is PT only too.
- **Reuse:** a self-training member = `role = 'client'` and `client_type <> 'pt'` (treat null as member). Since
  coaches already can't see them and Today views are PT-only, C1's "not in coach today views" holds with no change.
- Gotcha: **dojos are all PT**, so self-training never applies to a dojo student.

## 4. Who logged / who planned

- `logged_sessions.logged_by uuid → profiles` **exists** (`db/2026-10-26-coach-logging.md`). Staff and
  coach writes must set it to themselves (RLS). A client's is null or themselves. **The brief's
  `alter table sessions add column logged_by` is not needed.**
- `exercise_logs.logged_by` exists too.
- `weekly_plans` has **no** `created_by` (point 5 above).
- Labels already exist: `loggedByLabel` in `lib/coach-today.ts` ("by Coach Ravi" / "by Anand"). The client app
  shows a generic "Logged by your coach".

## 5. RLS today for the `client` role (`db/2026-10-30-rls-hardening.md`, `db/2026-11-05-exercise-logs.md`)

All tables also have the restrictive `iso <table> active` rule (archived logins get nothing).

| Table | select | insert | update | delete |
|---|---|---|---|---|
| `weekly_plans` | own (`client_id = auth.uid()`) | **no** | **no** | no |
| `logged_sessions` | own | own, `logged_by` null or self, plan link must be own plan | **no** | no |
| `exercise_logs` | own | own session + own company, `logged_by` null or self | own (**any row, also coach-logged**, point 4) | no |
| `session_feedback` | own sessions' | star rating only | no | no |
| `profiles` | own | — (server only) | own, column-guarded by trigger | no |
| `companies` | own gym's row | no | no (owner: logo / banner only; trigger is an allow-list, so a new `client_settings` column is automatically Super-Admin-only) | no |

So for Part C, self-training clients need **insert + update on `weekly_plans`** and **update on
`logged_sessions`** (own rows only). Exercise logs already allow it.

## 6. Feature toggles in Super Admin

- They are plain boolean columns on `companies`: `client_module_enabled`, `feedback_enabled`,
  `ai_insights_enabled`, `session_notes_enabled`, `ai_plans_enabled`, `ai_diet_enabled`, `multi_country_enabled`,
  `grading_enabled`, and others.
- **UI:** `app/admin/page.tsx`, the company edit panel (around lines 1520–1600). Each has an ON / OFF button
  that flips `editingCompany.<flag>`, and the save (`~line 530`) sends them in one `companies` update.
  Optional columns are sent only when present (`'ai_plans_enabled' in editingCompany`).
- Grading is a separate card (`app/belts-editor.tsx`) that saves straight away.
- There is no jsonb settings column today. `client_settings` would be the first, following the same
  "send only once the column exists" pattern.
- Owners can't change any of them (`protect_company_columns`), which matches "Super Admin only". The page is
  `/admin`, which only super admin can open (`proxy.ts`), so the card is invisible to owner, partner and coach
  by construction.

## 7. PDF progress report

- **Builder:** `lib/progress-pdf.ts` (`buildProgressPdf` / `downloadProgressPdf`, jsPDF via `lib/pdf.ts`).
  Input is `ProgressPdfInput`: client, week or `month` range, tiles, weekly charts or `monthlyTotals`,
  `strength: StrengthReport`, optional plan.
- **Strength section** = `strengthReport(logs, library, upTo)` from `lib/exercise-logs.ts`: top weight per
  month for the last 3 months, change since start, and a trend line per row. The single-exercise chart has
  been off since 14 Nov.
- **Called from:** `app/company/client/[id]/page.tsx:2044 / :2068` (Share progress → Week | Month). The month
  numbers and WhatsApp text come from `lib/monthly-report.ts` (#104), and the messages from
  `lib/progress-share.ts` (`pickRecipient`, `waPhone`).
- **C4 reuse:** the monthly PDF already exists per client. The "Monthly reports" list mostly needs:
  - a member list and a month picker,
  - a coach note field,
  - new-bests / stalled / not-done rows (the same helpers as A1),
  - the consultation block with the gym's `companies.phone` as a `wa.me` link (`waDigits`).
  - It runs on data the client page loads today. For "Generate all" it needs to load per member.

## 8. Draft SQL

`db/2026-11-19-client-view.md`: `client_settings`, `weekly_plans.created_by`, `logged_sessions.client_note`,
the `client_setting()` / `is_self_training_client()` helpers, restrictive switch rules, the self-training
plan / session rules (`alter policy`, old text kept for undo), an optional duplicate guard, and a test query
per policy. Additive only. **Not run.**

## Other notes for Part A

- **Owner and coach page are one page** (`app/company/client/[id]/page.tsx`, 4401 lines), so A5 is one place.
- **Bodyweight:** `progressBy` only sets `topWeight` from sets with kg. A2's "best reps" needs a small extension
  (best reps per period when there is no kg), added to the shared helpers.
- **"Logged by" in the A4 history** needs the staff list. The page already loads it (`loadGymStaff`), and the
  client mode will show "you" / "your coach" without staff names.

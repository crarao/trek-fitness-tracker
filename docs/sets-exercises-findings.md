# Weight and reps per set + one name per exercise — Task 0 findings (17 Nov 2026)

Read-only review of the code on `dev` (after the Save session bar work, crarao/trek-fitness-tracker#133–#139)
before building "weight and reps per set" and "one name per exercise". Nothing has been changed yet.

**Short version:** most of the plan fits, and **no new SQL is needed for the per-set numbers**. The table that
stores weights already has an unused `set_details jsonb` column. Five points don't match the plan as written and
need a decision before Task 1 (section 7).

---

## 1. How weight and reps are stored today (Nov 5–6 build, ROADMAP #80)

**Table `public.exercise_logs`** (`db/2026-11-05-exercise-logs.md`, run on Mumbai 5 Nov; dev was copied from Mumbai):
**one row per exercise per session**, in fixed columns. Not JSON on the session.

| Column | Type / rule | Notes |
|---|---|---|
| `session_id` → `logged_sessions` | not null, cascades | |
| `client_id`, `company_id` | copies, checked by RLS | |
| `exercise_id` → `exercises` | null = name not in the library | filled on save by `resolveExerciseId` (exact name / alias match only) |
| `exercise_name` | text 1–120, not null | copy of the plan's name |
| `name_key` | generated: `lower(btrim(exercise_name))` | **not** the same formula as the new `nameKey()` (see 7e) |
| `position` | smallint | index of the exercise in the plan day |
| `sets` | smallint, check 1–20 | **one value per exercise** |
| `reps` | smallint, check 1–200 | **one value per exercise** |
| `weight` | numeric(6,2), check 0–1000, null = bodyweight | **one value per exercise** |
| `unit` | `kg` (`lb` allowed, not used) | |
| `set_details` | **jsonb, nullable, unused** | the DB comment says "optional `[{reps, weight}]` when sets differ (pyramids); not used yet" |
| `logged_by`, `created_at` | | |

Example row, shaped like the test insert in `db/2026-11-05-exercise-logs.md` Step 3. This is **not live data**:
this session has no database access.

```json
{ "session_id": "e1e1e1e1-…-000000000001", "exercise_id": "<starter list id>", "exercise_name": "ZZ Squat",
  "position": 0, "sets": 3, "reps": 10, "weight": 12, "unit": "kg", "set_details": null }
```

Shown as "Squat 3×10 @ 12 kg" (`logLine`).

**The session row** (`logged_sessions`) also has `exercises_done jsonb` = `{ "done": ["Squat", "Bench Press"], "total": 8 }`.
These are the ticked exercise **names** only, with no numbers. The client app writes it too (`app/client/page.tsx`), and the coach's
half-way save updates it (`addToCoachSession`).

**Where the numbers are entered:** the coach / owner / partner only, on the client page, Plans tab, this week's day.
Ticking an exercise shows one row: `Sets × reps` + `Weight (kg)` with −/+ (`renderWeightRow`). The row is pre-filled from the
client's last log of that exercise (`lastLogFor` → `prefill`), else from the plan's own numbers (`parseSets` / `parseReps` /
`parseWeight`). Unsaved numbers live on the phone as `LogDraft = { sets, reps, weight }` under `coach-weights:<planId>:<Day>`.
Saved by `rowsToSave` → `insert` into `exercise_logs` (`handleCoachLogDay`, `addToCoachSession`, `retryWeights`).
**The client app doesn't enter or read weights.**

## 2. Plan JSON shape (manual and AI)

`weekly_plans.plan_json` (`lib/plan-structure.ts`):

```ts
PlanJson = { version: 1, days: PlanDay[7] /* Mon…Sun */, note: string }
PlanDay = { day: 'Mon'…'Sun', rest: boolean, focus: string, exercises: PlanExercise[] }
PlanExercise = { name: string, sets: string /* "3" */, reps: string /* "10", "8–12", "30 s" */, rest: string,
                 note: string, weight?: string /* "20 kg", "bodyweight", "RPE 7" */, exercise_id?: string }
```

Older plans have only `plan_details` (text), with no `plan_json`.

**Do plan exercises carry an exercise ID?** Only sometimes:
- **Manual plan builder:** yes, when picked from the picker (`addPicked` sets `exercise_id`). Typing in an exercise's name box
  **clears it** (`exercise_id: undefined`), so an edited name becomes free text.
- **AI plans:** no. `/api/generate-plan` returns names only. When the weights are saved later, `resolveExerciseId` matches
  the name exactly (name or alias, ignoring case, spaces and dashes). Unmatched names are saved with `exercise_id = null`.
- **Text plans converted to days** (`textToPlan`), **copied plans** (`app/plan-copy-sheet.tsx`, copies whatever the source had):
  same as above.

## 3. Where `exercises` is already used

- **Picker exists:** `app/exercise-picker.tsx` (bottom sheet). It searches name + aliases (`searchExercises`), has muscle /
  equipment chips, shows recently used first, skips archived, and offers "+ Add '<typed>' as new exercise" (asks the muscle group, inserts with
  the gym's `company_id`; global rows are never written). There's **no "Did you mean"**: it only hides "Add" when the name exists
  exactly (`hasExactName`). It shows all matches, not a top 8.
- **Used in one screen only:** the manual plan builder (`app/plan-editor.tsx`, "+ Add exercise").
- **Library management:** `/company/exercises` (owner / partner): add, rename, set muscle / equipment, archive.
- **Name matching for logs:** `matchExercise`, `resolveExerciseId`, `lastLogFor`, `progressKey` in `lib/exercise-logs.ts`
  (exact name or alias; no fuzzy match).
- The client page loads the library once (`exLibrary`) for matching.

## 4. Where an exercise name is still free text

1. **Manual plan builder:** each exercise's name box (`app/plan-editor.tsx` line ~208) is a text input. Typing replaces the
   picked name and clears `exercise_id`.
2. **AI plan save:** names straight from the model (`handleAssignGeneratedPlan` → `insertPlan`), no `exercise_id`.
3. **"Convert to day-by-day"** of an old text plan (`textToPlan`): names parsed from text.
4. **Old text-only plans:** no structured exercises at all (nothing to log weights against).
5. **The library itself** (`/company/exercises` add / rename, picker's "Add as new"): typed on purpose.
6. **Session form (`app/session-form.tsx`):** has **no exercise fields** (minutes, date, feeling, notes). There is no
   "Add exercise" in it today; exercises come only from the plan day.

## 5. Everything that reads exercise names or weights

| Where | Code | What it shows |
|---|---|---|
| Plan day, ticked exercise | `renderWeightRow` → `lastLogFor`, `logDetail` | pre-fill + "Last time: 3×10 @ 12 kg · 10 Nov" |
| Plan day, half-way save | `savedLog` + `logDetail` | "Saved · 3×10 @ 40 kg" |
| Sessions tab list | `logsBySession` + `logLine` | "Squat 3×10 @ 12 kg" per exercise |
| Progress tab chart | `app/exercise-progress.tsx` → `progressBy` (Weeks / Months) | **top weight per week / month** (not per session) + volume, grouped by `progressKey` (id, else exact name match, else squashed name) |
| Progress PDF | `strengthReport` → `lib/progress-pdf.ts` | heaviest weight per month, last 3 months, change since first |
| Monthly WhatsApp message | `strengthGains` (`lib/monthly-report.ts`) | top 3 gains this month |
| Save bar summary | `saveSummary` (client page) | "4 exercises · 11 sets entered" (from `LogDraft.sets`) |
| Saved exercise ticks | `tickedFromSaved` / `exercisesDoneFor` | `exercises_done` names (matched by name) |
| Check script | `scripts/check-exercise-logs.ts` | rules above |

Volume today = `sets × reps × weight` per row, only rows with all three.

## 6. SQL for the per-set numbers

Weight / reps are in **fixed columns**, but **no `alter table` is needed**: `exercise_logs.set_details jsonb` already
exists on Mumbai (5 Nov) and on dev (copied 10 Nov), unused and nullable. **Proposal:** new saves write
`set_details = [{ "kg": 5, "reps": 3 }, { "kg": 7, "reps": 4 }]` **and** keep filling the fixed columns as a summary:
- `sets` = number of sets
- `reps` / `weight` = the heaviest set

This keeps the existing checks, indexes and any cached old app version working. `setsOf()` reads `set_details` when present, else turns
`sets / reps / weight` into that many equal sets. Old rows are never rewritten.

(The DB comment says `[{reps, weight}]`. I'd use the plan's `{kg, reps}` and have `setsOf()` accept both keys.)

The `name_key` SQL for `exercises` (`claude/db-2026-11-17-exercises-sets.md`) **isn't in the repo**. See 7e.

## 7. What doesn't fit the plan: decisions needed

**a. Where a logged exercise lives.** The plan's Task 2 shape `{ exercise_id, name, sets: [...] }` reads like JSON on the
session. Today it's a **row** in `exercise_logs` (one per exercise, RLS per gym / client, indexed for "last time").
**Recommendation:** keep the table and map the shape onto it: `exercise_id`, `exercise_name` (= `name`, always kept),
`set_details` (= `sets`). No new column, no session JSON, and old readers keep working.

**b. "Session form's Add exercise" doesn't exist.** Weights are only logged against **exercises in the plan day** (tick → row).
Adding an exercise that isn't in the plan while logging would be new. **Options:**
(1) the set rows go on the plan day's ticked exercises (where they are today) and there's no "Add exercise" in this build; or
(2) also add "+ Add exercise" (picker) under the day's list for unplanned exercises. They'd be saved as `exercise_logs`
rows (position after the plan's) and in `exercises_done`, without changing the plan.
**Recommendation: (2)**, since coaches do swap exercises on the floor. It's the bigger of the two.

**c. "No free-text exercise name anywhere."** The plan builder's name box is the only typed name left in the coach flow.
Replacing it with a tap-to-pick field (tap the name → picker; rename = pick another) removes free typing there.
Existing plans keep their names. AI names stay as returned (Task 5 only links ids), and "Convert to day-by-day" stays as is.
OK?

**d. Chart: per session vs per week / month.** The Progress chart today plots **one point per week or month** (Weeks /
Months toggle, `progressBy`), not per session. **Recommendation:** keep Weeks / Months. Each point = the **heaviest set**
in that period (with its reps, e.g. "40 kg × 6") and **volume = Σ kg × reps** over every set. The PDF matches (monthly).
Uniform old rows give the same numbers as today.

**e. `nameKey()` vs the database.** The plan says `nameKey(name)` = `name.toLowerCase().replace(/[^a-z0-9]/g, '')` and
"must match the DB's `name_key` exactly". The new `exercises.name_key` SQL file (`claude/db-2026-11-17-exercises-sets.md`,
run on dev) **isn't in the repo**, so I can't check the expression or copy it into `db/2026-11-17-exercises-name-key.md`.
**Please paste it** (or commit it). Notes:
- The app's existing `squash()` (`normalizeName` without spaces) is already exactly `lower` + keep only `a–z0–9`, so
  `nameKey()` = `squash()` and the existing search and matching agree with it.
- `exercise_logs.name_key` (5 Nov) is a different formula, `lower(btrim(name))`. The code never groups by it (it
  squashes in JS), so it can stay. I won't change it.
- A **unique** `name_key` per company will fail on existing duplicates like "Push-up" / "Pushup" in one gym. It also
  needs `coalesce(company_id, …)` (as the 1 Nov index does) to stop duplicates in the global list. If it ran on dev
  without error, dev is fine. Mumbai should get a duplicate check first.

**f. Also affected (fits the plan, just noting):**
- Unsaved numbers on the phone (`coach-weights:` drafts, the `cb-draft`) change from `{sets, reps, weight}` to a list
  of sets. Old drafts are read with the same `setsOf()` rule.
- The **half-way save** (`addToCoachSession`) and **Retry weights** insert the same rows, so they get sets for free.
- **Set row count:** the plan says rows start from the plan's sets (default 3). **Recommendation:** values come from the
  same set of the last log (set 1 ← last set 1…). If the last log had fewer sets, its last set is repeated. With no last
  log, the plan's reps / weight are used. This keeps today's "pre-filled from last time".
- Max 20 sets (the `sets` check).
- Client app: no change (no weights there).
- Regression: there's no exercise-log regression test yet. I'd add one for "3 sets saved → one row with 3 sets"
  once the regression logins work again (`QA_LOGINS_DEV`).

## 8. Proposed order once a–e are agreed

Task 1 helpers (`nameKey` = `squash`, `findExercise` with fuzzy match, `setsOf`, plus checks) → Task 2/3 set rows on the
plan day + `set_details` saves → Task 4 picker "Did you mean" + name box → picker (+ "Add exercise" on the day if 7b = 2)
→ Task 5 AI save links ids → Task 6 chart / PDF / WhatsApp / session list read `setsOf()` → Task 7 cleanup files.
No SQL for Tasks 1–6. Task 7 writes SQL files only, for Anand to run.

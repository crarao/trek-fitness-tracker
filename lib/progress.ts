// Per-exercise progress (19 Nov, Part A of the client view build): one place for the grouping and the
// numbers used by the progress list (components/progress/ExerciseProgress.tsx: coach, client and self modes)
// and the PDF report (lib/progress-pdf.ts through strengthReport). Pure functions, no Supabase calls
// (check: scripts/check-progress.ts).
//
// The older helpers stay in lib/exercise-logs.ts (Rule #1: nothing removed); they are re-exported here
// so new code imports progress from one file.
//
// Rules:
//  - One row per exercise: exercise_id, else findExercise (no typo guessing), else nameKey (progressKey).
//  - One entry per session: logs of the same exercise in the same session are joined (their sets added).
//  - Value of an entry = its heaviest set's kg; bodyweight exercises (no kg in any entry) use best reps.
//  - Range: Weeks = the last 4 Monday weeks (this week included); Months = the last 6 months.
//  - Change = latest entry in the range vs the first entry in the range (null with one entry).
//  - New best: the range's best value beats every earlier entry (needs at least one earlier entry).
//  - Stalled: 3+ entries in the range and no later one beats the first in value or volume.
//  - Not done: in the plan, and no entry in the last 14 days (never done counts too).

import { type Exercise } from './exercises'
import { type PlanJson } from './plan-structure'
import {
  type DatedLog, type Period, type SetEntry, setsOf, heaviestSet, setsVolume, progressKey, isTimedOrDistance,
  lastWeeks, lastMonths, weekOf, weightText,
} from './exercise-logs'

export {
  progressBy, monthlyProgress, weeklyProgress, progressKey, strengthReport, changeSinceStart, fromFirstWeight,
  topWeightSeries, withWeightIn, lastWeeks, lastMonths, weekOf, periodOf, setsOf, heaviestSet, setsVolume, setsText,
  weightText, changeText,
} from './exercise-logs'
export type { DatedLog, Period, SetEntry, ExerciseProgress, PeriodPoint, StrengthReport, StrengthRow } from './exercise-logs'

export const RANGE_WEEKS = 4
export const RANGE_MONTHS = 6
export const NOT_DONE_DAYS = 14
export const STALL_SESSIONS = 3

// A log as the progress list reads it: the session's date plus who saved it
export type ProgressLog = DatedLog & { logged_by?: string | null }

export type ProgressRange = {
  by: Period
  periods: string[] // Monday weeks ("2026-11-02") or months ("2026-11"), oldest first
  start: string     // first day of the range (YYYY-MM-DD)
  end: string       // today (YYYY-MM-DD)
}

export function progressRange(today: string, by: Period): ProgressRange {
  const periods = by === 'week' ? lastWeeks(today, RANGE_WEEKS) : lastMonths(today.slice(0, 7), RANGE_MONTHS)
  return { by, periods, start: by === 'week' ? periods[0] : `${periods[0]}-01`, end: today }
}

// One exercise done in one session
export type ProgressEntry = {
  date: string             // session date
  sessionId: string
  sets: SetEntry[]
  top: SetEntry | null     // heaviest set (most reps for bodyweight)
  volume: number           // Σ kg × reps
  reps: number             // Σ reps
  loggedBy: string | null  // logged_by of the newest log in it (null = the client / not recorded)
  savedAt: string
}

export type ExerciseRow = {
  key: string
  name: string               // the library's clean name, else the latest name typed
  exerciseId: string | null
  muscleGroup: string | null
  bodyweight: boolean        // no kg in any entry: values are reps
  entries: ProgressEntry[]   // every entry, oldest first
  inRange: ProgressEntry[]   // entries in the range, oldest first
  latest: ProgressEntry | null // newest in the range, else newest at all
  lastDone: string | null
  daysSince: number | null   // days since lastDone (null = never)
  change: number | null      // latest vs first in the range, kg (reps for bodyweight); null with < 2 entries
  series: (number | null)[]  // best value per range period (null = not done then: a gap)
  newBest: boolean
  stalled: boolean
  notDone: boolean
  planDays: number[]         // positions in planWorkoutDays() of the plan days that have it
}

const round1 = (n: number) => Math.round(n * 10) / 10

// Days from a to b (YYYY-MM-DD), in UTC so the viewer's timezone can't move it
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((t(b) - t(a)) / 86400000)
}

// The value compared for an entry: heaviest kg, or best reps for a bodyweight exercise
export const entryValue = (e: ProgressEntry, bodyweight: boolean): number =>
  bodyweight ? Math.max(0, ...e.sets.map(s => s.reps ?? 0)) : (e.top?.kg ?? 0)

// Volume compared for "stalled": Σ kg × reps, or total reps for a bodyweight exercise
export const entryVolume = (e: ProgressEntry, bodyweight: boolean): number => (bodyweight ? e.reps : e.volume)

// The plan's workout days (not rest days, with at least one exercise), in Mon…Sun order: "Day 1, Day 2…"
export function planWorkoutDays(plan: PlanJson | null): PlanJson['days'] {
  return plan ? plan.days.filter(d => !d.rest && d.exercises.length) : []
}

// Entries per exercise key (logs of one session joined)
function entriesByKey(logs: ProgressLog[], library: Exercise[]) {
  const memo = new Map<string, string>()
  const groups = new Map<string, { latestName: string; latestStamp: string; exerciseId: string | null; bySession: Map<string, ProgressLog[]> }>()
  for (const l of logs) {
    const m = `${l.exercise_id ?? ''}|${l.exercise_name}`
    const key = memo.get(m) ?? progressKey(l, library)
    memo.set(m, key)
    const g = groups.get(key) ?? { latestName: l.exercise_name, latestStamp: '', exerciseId: null, bySession: new Map() }
    const stamp = `${l.session_date} ${l.created_at}`
    if (stamp > g.latestStamp) { g.latestStamp = stamp; g.latestName = l.exercise_name }
    if (key.startsWith('id:')) g.exerciseId = key.slice(3)
    const list = g.bySession.get(l.session_id) ?? []
    list.push(l)
    g.bySession.set(l.session_id, list)
    groups.set(key, g)
  }
  return groups
}

function toEntry(sessionId: string, logs: ProgressLog[]): ProgressEntry {
  const sorted = [...logs].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at))
  const sets = sorted.flatMap(l => setsOf(l))
  const newest = [...logs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  return {
    date: newest.session_date.slice(0, 10), sessionId, sets,
    top: heaviestSet(sets), volume: setsVolume(sets),
    reps: sets.reduce((n, s) => n + (s.reps ?? 0), 0),
    loggedBy: newest.logged_by ?? null, savedAt: newest.created_at,
  }
}

const periodKey = (date: string, by: Period) => (by === 'month' ? date.slice(0, 7) : weekOf(date))

// One row per exercise logged (any time) or in the plan, sorted most recently done first
// (never done last, by name).
export function exerciseRows(args: {
  logs: ProgressLog[]
  library: Exercise[]
  range: ProgressRange
  plan?: PlanJson | null
}): ExerciseRow[] {
  const { logs, library, range, plan } = args
  const groups = entriesByKey(logs.filter(l => l.session_date.slice(0, 10) <= range.end), library)
  const rows = new Map<string, ExerciseRow>()

  for (const [key, g] of groups) {
    const entries = [...g.bySession.entries()].map(([id, ls]) => toEntry(id, ls))
      .sort((a, b) => a.date.localeCompare(b.date) || a.savedAt.localeCompare(b.savedAt))
      .filter(e => e.sets.length)
    if (!entries.length) continue
    const ex = g.exerciseId ? library.find(e => e.id === g.exerciseId) : null
    const bodyweight = !entries.some(e => e.sets.some(s => s.kg))
    const inRange = entries.filter(e => e.date >= range.start)
    const earlier = entries.filter(e => e.date < range.start)
    const latest = inRange[inRange.length - 1] ?? entries[entries.length - 1]
    const val = (e: ProgressEntry) => entryValue(e, bodyweight)
    const vol = (e: ProgressEntry) => entryVolume(e, bodyweight)
    const first = inRange[0]
    const change = inRange.length >= 2 ? round1(val(inRange[inRange.length - 1]) - val(first)) : null
    const best = inRange.length ? Math.max(...inRange.map(val)) : 0
    const newBest = inRange.length > 0 && earlier.length > 0 && best > 0 && best > Math.max(...earlier.map(val))
    const stalled = inRange.length >= STALL_SESSIONS
      && !inRange.slice(1).some(e => val(e) > val(first) || vol(e) > vol(first))
    const series = range.periods.map(p => {
      const vs = inRange.filter(e => periodKey(e.date, range.by) === p).map(val)
      return vs.length ? Math.max(...vs) : null
    })
    const lastDone = entries[entries.length - 1].date
    rows.set(key, {
      key, name: ex?.name || g.latestName, exerciseId: g.exerciseId, muscleGroup: ex?.muscle_group ?? null,
      bodyweight, entries, inRange, latest, lastDone, daysSince: daysBetween(lastDone, range.end),
      change, series, newBest, stalled, notDone: false, planDays: [],
    })
  }

  // The plan's exercises: which days have them, and "not done in 2+ weeks"
  planWorkoutDays(plan ?? null).forEach((d, dayIdx) => {
    for (const e of d.exercises) {
      if (!e.name.trim() || isTimedOrDistance(e)) continue
      const key = progressKey({ exercise_id: e.exercise_id ?? null, exercise_name: e.name }, library)
      let row = rows.get(key)
      if (!row) {
        const ex = key.startsWith('id:') ? library.find(x => x.id === key.slice(3)) : null
        row = {
          key, name: ex?.name || e.name.trim(), exerciseId: key.startsWith('id:') ? key.slice(3) : null,
          muscleGroup: ex?.muscle_group ?? null, bodyweight: false, entries: [], inRange: [], latest: null,
          lastDone: null, daysSince: null, change: null, series: range.periods.map(() => null),
          newBest: false, stalled: false, notDone: false, planDays: [],
        }
        rows.set(key, row)
      }
      if (!row.planDays.includes(dayIdx)) row.planDays.push(dayIdx)
    }
  })
  for (const row of rows.values()) {
    if (row.planDays.length) row.notDone = row.daysSince == null || row.daysSince >= NOT_DONE_DAYS
  }

  return [...rows.values()].sort((a, b) =>
    (b.lastDone ?? '').localeCompare(a.lastDone ?? '')
    || (b.latest?.savedAt ?? '').localeCompare(a.latest?.savedAt ?? '')
    || a.name.localeCompare(b.name))
}

export type ProgressSummary = { newBests: number; stalled: number; notDone: number }

export function progressSummary(rows: ExerciseRow[]): ProgressSummary {
  return {
    newBests: rows.filter(r => r.newBest).length,
    stalled: rows.filter(r => r.stalled).length,
    notDone: rows.filter(r => r.notDone).length,
  }
}

// ---- Text ----

// "10 kg × 10", "12 reps", "" (no sets)
export function bestSetText(e: ProgressEntry | null, bodyweight: boolean): string {
  if (!e?.top) return ''
  if (bodyweight) {
    const reps = Math.max(0, ...e.sets.map(s => s.reps ?? 0))
    return reps ? `${reps} reps` : ''
  }
  const { kg, reps } = e.top
  return kg ? `${weightText(kg)} kg${reps ? ` × ${reps}` : ''}` : reps ? `${reps} reps` : ''
}

// "+2.5 kg", "−5 kg", "0 kg", "+3 reps"; "—" for null
export function changeAmountText(change: number | null, bodyweight: boolean): string {
  if (change == null) return '—'
  const unit = bodyweight ? ' reps' : ' kg'
  const n = weightText(Math.abs(change))
  return change > 0 ? `+${n}${unit}` : change < 0 ? `−${n}${unit}` : `0${unit}`
}

// Sets in a short form for the history table: "5×3 · 7×4 · 9×4" (kg × reps); bodyweight sets "12 · 10"
export function compactSets(sets: SetEntry[]): string {
  return sets.map(s => (s.kg && s.reps ? `${weightText(s.kg)}×${s.reps}` : s.kg ? `${weightText(s.kg)} kg` : `${s.reps ?? ''}`)).join(' · ')
}

// ---- Chart axis ----

// The y-axis for a series: from 0, unless the values sit high up, then a padded range that is never
// tighter than ±20% of the max (so a 5 kg change doesn't fill the chart). Rounded to a nice step.
export function chartAxis(values: (number | null)[]): { min: number; max: number; step: number } {
  const vs = values.filter((v): v is number => v != null && v > 0)
  if (!vs.length) return { min: 0, max: 10, step: 2 }
  const hi = Math.max(...vs), lo = Math.min(...vs)
  const pad = hi * 0.2
  let min = Math.max(0, Math.min(lo, hi - pad) - pad)
  let max = hi + pad
  // Close to 0 anyway: start at 0
  if (min < hi * 0.5) min = 0
  const step = niceStep((max - min) / 4)
  min = Math.floor(min / step) * step
  max = Math.ceil(max / step) * step
  return { min, max, step }
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}


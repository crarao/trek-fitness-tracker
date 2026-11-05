// Weight / reps per exercise per session (public.exercise_logs, db/2026-11-05-exercise-logs.md, ROADMAP #80).
// One row per exercise per session: "Squat 3 × 10 @ 12 kg". v1: the coach saves them with "Mark done for
// <client>" (app/company/client/[id]); the client app doesn't log weights yet. kg only in the app.
//
// Rules here, so the page and scripts/check-exercise-logs.ts agree:
//  - pre-fill: the client's last log of the same exercise (by exercise_id, else by name / other names),
//    else the plan's own numbers read from its text ("3", "8–12", "20 kg")
//  - timed / distance exercises ("30 s", "1 km") get no weight row
//  - on save, a typed or AI name is matched to the library so the row stores the exercise's id
//  - monthly top weight and volume per exercise, and "+X% this month"

import { type Exercise, normalizeName } from './exercises'
import { type PlanExercise } from './plan-structure'

export type ExerciseLog = {
  id: string
  session_id: string
  exercise_id: string | null
  exercise_name: string
  position: number
  sets: number | null
  reps: number | null
  weight: number | null
  unit: string
  created_at: string
}

export const EXERCISE_LOG_COLUMNS = 'id, session_id, exercise_id, exercise_name, position, sets, reps, weight, unit, created_at'

// What the coach sees and edits on a ticked exercise (numbers, null = empty)
export type LogDraft = { sets: number | null; reps: number | null; weight: number | null }

// A log with the date of its session (from logged_sessions), so logs can be put in order and months
export type DatedLog = ExerciseLog & { session_date: string }

const MAX_SETS = 20
const MAX_REPS = 200
const MAX_WEIGHT = 1000

// ---- Reading the plan's text ----

// Reps / time written as a duration or a distance: "30 s", "45 sec", "2 min", "1 km", "400 m", "20 min walk"
const TIMED = /\d\s*(s|sec|secs|second|seconds|min|mins|minute|minutes|h|hr|hrs|hour|hours|m|km|kms|mi|mile|miles|meter|meters|metre|metres|steps|laps?)\b/i

export function isTimedOrDistance(e: Pick<PlanExercise, 'reps' | 'sets'>): boolean {
  return TIMED.test(e.reps || '') || TIMED.test(e.sets || '')
}

const firstInt = (text: string | null | undefined): number | null => {
  const m = (text || '').match(/\d+/)
  return m ? Number(m[0]) : null
}

// "3" → 3, "3 sets" → 3, "" → null
export function parseSets(text: string | null | undefined): number | null {
  const n = firstInt(text)
  return n && n >= 1 && n <= MAX_SETS ? n : null
}

// "10" → 10, "8–12" → 8 (the low end), "12 each side" → 12, "30 s" / "AMRAP" / "" → null
export function parseReps(text: string | null | undefined): number | null {
  if (!text || TIMED.test(text)) return null
  const n = firstInt(text)
  return n && n >= 1 && n <= MAX_REPS ? n : null
}

// "20 kg" → 20, "12.5kg" → 12.5, "20" → 20, "2 x 10 kg" → 10, "45 lb" → 20 (to kg, nearest 0.5),
// "bodyweight" / "BW" / "RPE 7" / "" → null
export function parseWeight(text: string | null | undefined): number | null {
  const t = (text || '').toLowerCase().replace(',', '.')
  if (!t.trim() || /rpe|rir|%|body\s*weight|\bbw\b/.test(t)) return null
  const unit = t.match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilo|kilos|lb|lbs|pound|pounds)\b/)
  if (unit) {
    const n = Number(unit[1])
    const kg = /^(lb|lbs|pound|pounds)$/.test(unit[2]) ? Math.round((n * 0.45359237) * 2) / 2 : n
    return kg > 0 && kg <= MAX_WEIGHT ? kg : null
  }
  if (!/^\s*\d+(?:\.\d+)?\s*$/.test(t)) return null
  const n = Number(t)
  return n > 0 && n <= MAX_WEIGHT ? n : null
}

// ---- Matching names to the library ----

const squash = (s: string) => normalizeName(s).replace(/ /g, '')

// The library exercise a plan name means: same name, else one of its other names (spaces and dashes
// ignored: "Lat Pull-Down" = "lat pulldown"). The gym's own exercise wins over the starter list,
// active over archived. null when nothing matches exactly (no guessing).
export function matchExercise(name: string, library: Exercise[]): Exercise | null {
  const key = squash(name)
  if (!key) return null
  const rank = (e: Exercise) => (e.is_archived ? 2 : 0) + (e.company_id ? 0 : 1)
  const byName = library.filter(e => squash(e.name) === key)
  if (byName.length) return [...byName].sort((a, b) => rank(a) - rank(b))[0]
  const byAlias = library.filter(e => (e.aliases || []).some(a => squash(a) === key))
  return byAlias.length ? [...byAlias].sort((a, b) => rank(a) - rank(b))[0] : null
}

// The id to save for a plan exercise: the plan's own id when it is in the viewer's library (starter list
// or this gym, which is what the database allows), else the library match by name, else null.
export function resolveExerciseId(e: Pick<PlanExercise, 'name' | 'exercise_id'>, library: Exercise[]): string | null {
  if (e.exercise_id && library.some(x => x.id === e.exercise_id)) return e.exercise_id
  return matchExercise(e.name, library)?.id ?? null
}

// All the names one exercise goes by (squashed), for matching logs saved without an id
function namesFor(name: string, id: string | null, library: Exercise[]): Set<string> {
  const out = new Set<string>([squash(name)])
  const ex = (id && library.find(x => x.id === id)) || matchExercise(name, library)
  if (ex) {
    out.add(squash(ex.name))
    for (const a of ex.aliases || []) out.add(squash(a))
  }
  out.delete('')
  return out
}

// ---- Pre-fill ----

// Newest first: later session date, then later saved
export function sortNewestFirst<T extends { session_date: string; created_at: string }>(logs: T[]): T[] {
  return [...logs].sort((a, b) => b.session_date.localeCompare(a.session_date) || b.created_at.localeCompare(a.created_at))
}

// The client's last log of this exercise: same exercise_id, else the same name or one of its other names
export function lastLogFor(e: Pick<PlanExercise, 'name' | 'exercise_id'>, logs: DatedLog[], library: Exercise[]): DatedLog | null {
  const id = e.exercise_id || matchExercise(e.name, library)?.id || null
  const names = namesFor(e.name, id, library)
  for (const l of sortNewestFirst(logs)) {
    if (id && l.exercise_id === id) return l
    if (names.has(squash(l.exercise_name))) return l
  }
  return null
}

// Starting numbers for a ticked exercise: the last log, else the plan's numbers. Timed / distance: no weight.
export function prefill(e: PlanExercise, last: Pick<ExerciseLog, 'sets' | 'reps' | 'weight'> | null): LogDraft {
  const timed = isTimedOrDistance(e)
  if (last) return { sets: last.sets, reps: timed ? null : last.reps, weight: timed ? null : last.weight }
  return { sets: parseSets(e.sets), reps: timed ? null : parseReps(e.reps), weight: timed ? null : parseWeight(e.weight) }
}

// −/+ on weight: 1 kg steps below 10 kg, 2.5 kg from 10 kg. Never below 0 (0 = bodyweight / empty).
export function stepWeight(w: number | null, dir: 1 | -1): number | null {
  const cur = w ?? 0
  if (dir === 1) {
    const step = cur < 10 ? 1 : 2.5
    return Math.min(MAX_WEIGHT, round1(cur + step))
  }
  const step = cur <= 10 ? 1 : 2.5
  const next = round1(cur - step)
  return next > 0 ? next : null
}

const round1 = (n: number) => Math.round(n * 10) / 10

// Number as typed into a box: "12.5" → 12.5, "" / "abc" → null, clamped to the allowed range
export function numberFromInput(text: string, kind: 'sets' | 'reps' | 'weight'): number | null {
  const t = text.replace(',', '.').trim()
  if (!t) return null
  const n = kind === 'weight' ? Number(t) : Math.round(Number(t))
  if (!isFinite(n) || n <= 0) return null
  const max = kind === 'sets' ? MAX_SETS : kind === 'reps' ? MAX_REPS : MAX_WEIGHT
  return kind === 'weight' ? Math.min(max, round1(n)) : Math.min(max, n)
}

// ---- Saving ----

export type LogInsert = {
  session_id: string
  client_id: string
  company_id: string
  exercise_id: string | null
  exercise_name: string
  position: number
  sets: number | null
  reps: number | null
  weight: number | null
  unit: 'kg'
  logged_by: string
}

// Rows for the ticked exercises of a day. Exercises with nothing filled in, and timed / distance ones,
// are left out (the tick itself is saved in logged_sessions.exercises_done as before).
export function rowsToSave(args: {
  exercises: PlanExercise[]
  ticked: number[]
  drafts: Record<number, LogDraft>
  sessionId: string
  clientId: string
  companyId: string
  loggedBy: string
  library: Exercise[]
}): LogInsert[] {
  const { exercises, ticked, drafts, sessionId, clientId, companyId, loggedBy, library } = args
  const out: LogInsert[] = []
  for (const i of [...ticked].sort((a, b) => a - b)) {
    const e = exercises[i]
    if (!e || isTimedOrDistance(e)) continue
    const d = drafts[i]
    if (!d || (d.sets == null && d.reps == null && d.weight == null)) continue
    out.push({
      session_id: sessionId, client_id: clientId, company_id: companyId,
      exercise_id: resolveExerciseId(e, library),
      exercise_name: e.name.trim().slice(0, 120),
      position: i,
      sets: d.sets, reps: d.reps, weight: d.weight,
      unit: 'kg', logged_by: loggedBy,
    })
  }
  return out
}

// ---- Showing ----

// 12 → "12", 12.5 → "12.5"
export const weightText = (w: number) => (Number.isInteger(w) ? String(w) : String(round1(w)))

// "3×10 @ 12 kg", "3×10", "3 sets @ 12 kg", "10 reps", "@ 12 kg", ""
export function logDetail(l: Pick<ExerciseLog, 'sets' | 'reps' | 'weight'>): string {
  const vol = l.sets && l.reps ? `${l.sets}×${l.reps}` : l.sets ? `${l.sets} sets` : l.reps ? `${l.reps} reps` : ''
  const load = l.weight ? `@ ${weightText(l.weight)} kg` : ''
  return [vol, load].filter(Boolean).join(' ')
}

// "Squat 3×10 @ 12 kg"
export const logLine = (l: Pick<ExerciseLog, 'exercise_name' | 'sets' | 'reps' | 'weight'>) =>
  [l.exercise_name, logDetail(l)].filter(Boolean).join(' ')

// ---- Progress by month or by week ----

// A period is a month ("2026-11") or a Monday week ("2026-11-02", like lib/weekly-totals.ts)
export type Period = 'month' | 'week'
export type PeriodPoint = { period: string; topWeight: number | null; volume: number; logs: number }
export type ExerciseProgress = {
  key: string          // "id:<uuid>" or "name:<normalised name>"
  name: string         // the latest name used
  logs: number
  points: PeriodPoint[] // oldest first, only periods with logs
}

// One key per exercise: the library id (from the log, else by name), else the normalised name
export function progressKey(l: Pick<ExerciseLog, 'exercise_id' | 'exercise_name'>, library: Exercise[]): string {
  const id = l.exercise_id || matchExercise(l.exercise_name, library)?.id
  return id ? `id:${id}` : `name:${squash(l.exercise_name)}`
}

// Monday of the week a date falls in. Plain date arithmetic in UTC on the YYYY-MM-DD string, so the
// viewer's timezone can't move it a day (same result as mondayOf in lib/weekly-totals.ts).
export function weekOf(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return t.toISOString().slice(0, 10)
}

export const periodOf = (date: string, by: Period) => (by === 'month' ? date.slice(0, 7) : weekOf(date))

// Per exercise and period: top weight (heaviest logged) and volume (sets × reps × weight, only rows
// with all three). Exercises with the most logs first.
export function progressBy(logs: DatedLog[], library: Exercise[], by: Period): ExerciseProgress[] {
  const groups = new Map<string, { name: string; latest: string; logs: number; points: Map<string, PeriodPoint> }>()
  for (const l of logs) {
    const key = progressKey(l, library)
    const period = periodOf(l.session_date, by)
    const g = groups.get(key) ?? { name: l.exercise_name, latest: '', logs: 0, points: new Map() }
    const stamp = `${l.session_date} ${l.created_at}`
    if (stamp > g.latest) { g.latest = stamp; g.name = l.exercise_name }
    g.logs++
    const p = g.points.get(period) ?? { period, topWeight: null, volume: 0, logs: 0 }
    p.logs++
    if (l.weight != null && l.weight > 0) p.topWeight = Math.max(p.topWeight ?? 0, l.weight)
    if (l.sets && l.reps && l.weight) p.volume = round1(p.volume + l.sets * l.reps * l.weight)
    g.points.set(period, p)
    groups.set(key, g)
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name, logs: g.logs, points: [...g.points.values()].sort((a, b) => a.period.localeCompare(b.period)) }))
    .sort((a, b) => b.logs - a.logs || a.name.localeCompare(b.name))
}

export const monthlyProgress = (logs: DatedLog[], library: Exercise[]) => progressBy(logs, library, 'month')
export const weeklyProgress = (logs: DatedLog[], library: Exercise[]) => progressBy(logs, library, 'week')

// "+X% this month" / "this week": this period's top weight vs the last earlier period with a weight.
// null when there is no weight this period or nothing earlier to compare with.
export function changeThisPeriod(p: ExerciseProgress, current: string): number | null {
  const cur = p.points.find(m => m.period === current)?.topWeight
  if (!cur) return null
  const prev = [...p.points].reverse().find(m => m.period < current && m.topWeight)?.topWeight
  if (!prev) return null
  return Math.round(((cur - prev) / prev) * 100)
}
export const changeThisMonth = changeThisPeriod

// "+14%", "−5%", "0%"
export const changeText = (pct: number) => (pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : '0%')

// The last `count` months up to `thisMonth` ("2026-11"), oldest first: ["2026-06", …, "2026-11"]
export function lastMonths(thisMonth: string, count: number): string[] {
  const [y, m] = thisMonth.split('-').map(Number)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// The last `count` Monday weeks up to the week of `date`, oldest first
export function lastWeeks(date: string, count: number): string[] {
  const [y, m, d] = weekOf(date).split('-').map(Number)
  const out: string[] = []
  for (let i = count - 1; i >= 0; i--) out.push(new Date(Date.UTC(y, m - 1, d - 7 * i)).toISOString().slice(0, 10))
  return out
}

// Top weight per period for a chart (null = no weight then, drawn as a gap)
export function topWeightSeries(p: ExerciseProgress, periods: string[]): (number | null)[] {
  return periods.map(x => p.points.find(pt => pt.period === x)?.topWeight ?? null)
}

// Exercises with a weight in any of these periods, most logs in them first
export function withWeightIn(progress: ExerciseProgress[], periods: string[]): ExerciseProgress[] {
  const set = new Set(periods)
  const count = (p: ExerciseProgress) => p.points.filter(x => set.has(x.period)).reduce((n, x) => n + x.logs, 0)
  return progress
    .filter(p => p.points.some(x => set.has(x.period) && x.topWeight))
    .sort((a, b) => count(b) - count(a) || a.name.localeCompare(b.name))
}

// ---- PDF report: "Strength by exercise" ----

export type StrengthRow = {
  name: string
  values: (number | null)[] // top weight per table month (null = "—")
  change: number | null     // this month vs the last earlier month with a weight
  first: boolean            // weight this month and none before: "first month"
}
export type StrengthReport = {
  months: string[]          // table months, oldest first ("2026-09", "2026-10", "2026-11")
  rows: StrengthRow[]
  chart: { name: string; months: string[]; data: (number | null)[] } | null
}

// Up to `rows` exercises with a weight in the last `months` months (most logged first), and a line
// chart of the most logged one over `chartMonths` months when it has at least two months to show.
// Only logs up to `upTo` (the report week's last day) count. null when there is nothing to show.
export function strengthReport(
  logs: DatedLog[], library: Exercise[], upTo: string,
  opts: { months?: number; rows?: number; chartMonths?: number } = {},
): StrengthReport | null {
  const thisMonth = upTo.slice(0, 7)
  const months = lastMonths(thisMonth, opts.months ?? 3)
  const progress = withWeightIn(monthlyProgress(logs.filter(l => l.session_date.slice(0, 10) <= upTo), library), months)
    .slice(0, opts.rows ?? 6)
  if (!progress.length) return null
  const rows = progress.map(p => {
    const change = changeThisPeriod(p, thisMonth)
    const hasNow = !!p.points.find(x => x.period === thisMonth)?.topWeight
    const earlier = p.points.some(x => x.period < thisMonth && x.topWeight)
    return { name: p.name, values: topWeightSeries(p, months), change, first: hasNow && !earlier }
  })
  const chartMonths = lastMonths(thisMonth, opts.chartMonths ?? 6)
  const data = topWeightSeries(progress[0], chartMonths)
  const chart = data.filter(v => v != null).length >= 2 ? { name: progress[0].name, months: chartMonths, data } : null
  return { months, rows, chart }
}

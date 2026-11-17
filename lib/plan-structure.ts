// Structured weekly plans (weekly_plans.plan_json).
// A structured plan always holds all 7 weekdays (Mon…Sun); days without training are rest days.
// plan_details (text) is always written alongside from planToText(), so older screens and
// anything that reads text keep working. Plans without plan_json are older text-only plans.

import { parseDate } from './locale'
import { summarizePlan, type PlanSummary } from './plan-summary'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
export type Weekday = typeof WEEKDAYS[number]

const FULL: Record<Weekday, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
}

export type PlanExercise = {
  name: string
  sets: string   // "3"
  reps: string   // "10", "8–12", "30 s", "1 km"
  rest: string   // "60 s" (free text so coaches can write what they like)
  note: string   // optional cue, e.g. "keep back flat"
  weight?: string      // optional load, e.g. "20 kg", "bodyweight", "RPE 7" (free text)
  exercise_id?: string // optional link to the exercise library (exercises.id); `name` is always the copy shown
  // Optional different weight / reps per set (17 Nov, e.g. a pyramid 20 kg × 10 · 25 kg × 8 · 30 kg × 6).
  // When set, sets / reps / weight above are kept as a text copy of it (setTargetFields) for older readers.
  set_targets?: SetTarget[]
}

export type SetTarget = { kg: number | null; reps: number | null }
const MAX_SET_TARGETS = 20

// "20 kg × 10 · 25 kg × 8 · 30 kg × 6" ("12 reps" / "20 kg" when one half is missing)
export function setTargetsText(rows: SetTarget[]): string {
  const kg = (n: number) => String(Math.round(n * 10) / 10)
  return rows.map(r => (r.kg && r.reps ? `${kg(r.kg)} kg × ${r.reps}` : r.kg ? `${kg(r.kg)} kg` : r.reps ? `${r.reps} reps` : '–')).join(' · ')
}

// The exercise with these set targets, and sets / reps / weight rewritten from them: "3", "10/8/6", "20/25/30 kg"
// (one value when every set has the same)
export function withSetTargets(e: PlanExercise, rows: SetTarget[]): PlanExercise {
  const list = rows.slice(0, MAX_SET_TARGETS)
  const join = (xs: (number | null)[]) =>
    xs.every(x => x === xs[0]) ? (xs[0] == null ? '' : String(xs[0])) : xs.map(x => (x == null ? '–' : String(x))).join('/')
  const reps = join(list.map(r => r.reps))
  const kgs = list.map(r => r.kg)
  const weight = kgs.some(k => k != null) ? `${join(kgs)} kg` : ''
  const next: PlanExercise = { ...e, sets: String(list.length), reps, set_targets: list }
  if (weight) next.weight = weight
  else delete next.weight
  return next
}

// Back to one target for every set: the first set's numbers (the set rows are dropped from this exercise)
export function withoutSetTargets(e: PlanExercise): PlanExercise {
  const first = e.set_targets?.[0]
  const { set_targets: rows, ...rest } = e
  const next: PlanExercise = { ...rest, sets: rows?.length ? String(rows.length) : e.sets, reps: first?.reps != null ? String(first.reps) : '' }
  if (first?.kg != null) next.weight = `${first.kg} kg`
  else delete next.weight
  return next
}

// Starting rows when "Different weight per set" is switched on: the exercise's sets (3 if none), each with
// its reps / weight numbers
export function startSetTargets(e: PlanExercise): SetTarget[] {
  const n = Math.min(MAX_SET_TARGETS, Math.max(1, parseInt(e.sets, 10) || 3))
  const reps = parseInt((e.reps || '').match(/\d+/)?.[0] || '', 10)
  const kg = /body\s*weight|\bbw\b/i.test(e.weight || '') ? NaN : Number((e.weight || '').replace(',', '.').match(/\d+(?:\.\d+)?/)?.[0])
  const row: SetTarget = { kg: kg > 0 ? kg : null, reps: reps > 0 && reps <= 200 ? reps : null }
  return Array.from({ length: n }, () => ({ ...row }))
}

function readSetTargets(v: unknown): SetTarget[] | null {
  if (!Array.isArray(v)) return null
  const num = (x: unknown, max: number, whole: boolean) => {
    const n = typeof x === 'string' ? Number(x) : x
    if (typeof n !== 'number' || !isFinite(n) || n <= 0 || n > max) return null
    return whole ? Math.round(n) : Math.round(n * 10) / 10
  }
  const rows = v.slice(0, MAX_SET_TARGETS).flatMap(x => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    return [{ kg: num(o.kg, 1000, false), reps: num(o.reps, 200, true) }]
  })
  return rows.length ? rows : null
}

export type PlanDay = {
  day: Weekday
  rest: boolean
  focus: string           // "Lower Body Strength"; ignored for rest days
  exercises: PlanExercise[]
}

export type PlanJson = {
  version: 1
  days: PlanDay[]         // exactly 7, Mon…Sun
  note: string            // closing note, e.g. "Review with your coach before starting."
}

export const emptyExercise = (): PlanExercise => ({ name: '', sets: '', reps: '', rest: '', note: '' })

// The client's available days ("Mon,Wed,Fri,Thu,Tue") as weekdays in Mon…Sun order, unknown values dropped
export function parseAvailableDays(availableDays?: string | null): Weekday[] {
  const set = new Set((availableDays || '').split(',').map(d => d.trim().slice(0, 3).toLowerCase()))
  return WEEKDAYS.filter(d => set.has(d.toLowerCase()))
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }

// Training days per week written in free text ("3 days a week", "four times per week", "3x/week",
// "5-day split"), or null. Needs "week" / "split" etc. after the number, so "surgery 3 days ago" doesn't count.
export function daysPerWeekMentioned(text?: string | null): number | null {
  const t = (text || '').toLowerCase()
  const n = '([1-7]|one|two|three|four|five|six|seven)'
  const m = t.match(new RegExp(`\\b${n}\\s*(?:x|times|days?)\\s*(?:a|per|each|every|/|in a)\\s*week`))
    || t.match(new RegExp(`\\b${n}[- ]days? (?:split|program|programme|plan|routine|schedule)`))
  if (!m) return null
  return NUMBER_WORDS[m[1]] ?? Number(m[1])
}

// A blank plan; the client's available days (e.g. "Mon,Wed,Fri") start as workout days
export function emptyPlan(availableDays?: string | null): PlanJson {
  const avail = new Set<string>(parseAvailableDays(availableDays))
  return {
    version: 1,
    note: '',
    days: WEEKDAYS.map(day => ({
      day,
      rest: !avail.has(day),
      focus: '',
      exercises: avail.has(day) ? [emptyExercise()] : [],
    })),
  }
}

export const MAX_EXERCISES_PER_DAY = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max)

function toWeekday(v: unknown): Weekday | null {
  const s = str(v).toLowerCase()
  return WEEKDAYS.find(d => s.startsWith(d.toLowerCase())) ?? null
}

// Cleans anything (AI output, database value) into a valid 7-day plan, or null if unusable
export function normalizePlan(raw: unknown): PlanJson | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { days?: unknown; note?: unknown }
  if (!Array.isArray(r.days)) return null
  const byDay = new Map<Weekday, PlanDay>()
  for (const d of r.days) {
    if (!d || typeof d !== 'object') continue
    const o = d as Record<string, unknown>
    const day = toWeekday(o.day)
    if (!day || byDay.has(day)) continue
    const exercises = (Array.isArray(o.exercises) ? o.exercises : [])
      .filter(e => e && typeof e === 'object')
      .map(e => {
        const x = e as Record<string, unknown>
        const ex: PlanExercise = { name: str(x.name, 120), sets: str(x.sets, 20), reps: str(x.reps, 40), rest: str(x.rest, 30), note: str(x.note, 160) }
        const weight = str(x.weight, 30)
        const id = str(x.exercise_id, 36)
        if (weight) ex.weight = weight
        if (UUID.test(id)) ex.exercise_id = id
        const targets = readSetTargets(x.set_targets)
        if (targets) ex.set_targets = targets
        return ex
      })
      .filter(e => e.name)
      .slice(0, MAX_EXERCISES_PER_DAY)
    const focus = str(o.focus, 60)
    const rest = o.rest === true || (exercises.length === 0 && !focus) || /^rest\b/i.test(focus)
    byDay.set(day, { day, rest, focus: rest && /^rest\b/i.test(focus) ? '' : focus, exercises })
  }
  if (byDay.size === 0) return null
  return {
    version: 1,
    note: str(r.note, 300),
    days: WEEKDAYS.map(day => byDay.get(day) ?? { day, rest: true, focus: '', exercises: [] }),
  }
}

// Removes blank exercise lines before saving; days with nothing to do become rest days
export function cleanPlan(plan: PlanJson): PlanJson {
  return normalizePlan(plan) ?? emptyPlan()
}

export const workoutDays = (plan: PlanJson) => plan.days.filter(d => !d.rest)

// Short label used on chips and saved with a logged session (logged_sessions.plan_day).
// Same shape as summarizePlan() labels for text plans: "Mon · Lower Body Strength", "Tue · Rest".
export function dayLabel(d: PlanDay): string {
  if (d.rest) return `${d.day} · Rest`
  let focus = d.focus || 'Workout'
  if (focus.length > 28) focus = focus.slice(0, 27).trimEnd() + '…'
  return `${d.day} · ${focus}`
}

// "3 x 10 @ 20 kg, rest 60 s" from the parts that are filled in
export function exerciseDetail(e: PlanExercise): string {
  if (e.set_targets?.length) return [setTargetsText(e.set_targets), e.rest ? `rest ${e.rest}` : ''].filter(Boolean).join(', ')
  const vol = e.sets && e.reps ? `${e.sets} x ${e.reps}` : e.sets ? `${e.sets} sets` : e.reps
  const load = e.weight ? (vol ? `${vol} @ ${e.weight}` : `@ ${e.weight}`) : vol
  return [load, e.rest ? `rest ${e.rest}` : ''].filter(Boolean).join(', ')
}

// Text copy saved in plan_details. Headings use full weekday names so summarizePlan() reads them.
export function planToText(plan: PlanJson): string {
  const blocks = plan.days.map(d => {
    if (d.rest) {
      const extra = d.exercises.map(e => `- ${e.name}${exerciseDetail(e) ? ' – ' + exerciseDetail(e) : ''}`)
      return [`${FULL[d.day]} – Rest day`, ...extra].join('\n')
    }
    const lines = d.exercises.map(e => {
      const detail = exerciseDetail(e)
      return `- ${e.name}${detail ? ' – ' + detail : ''}${e.note ? ` (${e.note})` : ''}`
    })
    return [`${FULL[d.day]} – ${d.focus || 'Workout'}`, ...lines].join('\n')
  })
  return [...blocks, ...(plan.note ? [`Note: ${plan.note.replace(/^note:\s*/i, '')}`] : [])].join('\n\n')
}

// The 7 days in the order the plan's week runs (a plan starting on Wednesday runs Wed…Tue)
export function daysInWeekOrder(plan: PlanJson, weekStart: string): PlanDay[] {
  const startIdx = (parseDate(weekStart.slice(0, 10)).getDay() + 6) % 7 // Mon = 0
  return [...plan.days.slice(startIdx), ...plan.days.slice(0, startIdx)]
}

// Today's weekday as Mon…Sun
export function todayWeekday(): Weekday {
  return WEEKDAYS[(new Date().getDay() + 6) % 7]
}

// ---- Converting an older text plan into days (coach reviews the result in the editor) ----

const DAY_WORDS: Record<string, Weekday> = {
  monday: 'Mon', mon: 'Mon', tuesday: 'Tue', tue: 'Tue', tues: 'Tue', wednesday: 'Wed', wed: 'Wed',
  thursday: 'Thu', thu: 'Thu', thurs: 'Thu', friday: 'Fri', fri: 'Fri', saturday: 'Sat', sat: 'Sat', sunday: 'Sun', sun: 'Sun',
}
const HEADING = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs)?|fri|sat|sun|day\s*(\d+))\b\.?\s*(?:[–—:\-]\s*)?(.*)$/i

// "Squats – 3 x 10, rest 60s (slow)" -> parts. Anything unrecognised stays in the name.
export function parseExerciseLine(line: string): PlanExercise {
  let text = line.replace(/^[-•*]\s*/, '').trim()
  let note = ''
  const noteM = text.match(/\(([^)]*)\)\s*$/)
  if (noteM) { note = noteM[1].trim(); text = text.slice(0, noteM.index).trim() }
  const parts = text.split(/\s+[–—-]\s+|:\s+/)
  const name = parts[0].trim()
  const rest = parts.slice(1).join(' – ')
  let sets = '', reps = '', restTime = '', weight = ''
  const vol = rest.match(/(\d+)\s*[x×]\s*([^,;@]+)/i)
  if (vol) { sets = vol[1]; reps = vol[2].trim() }
  const r = rest.match(/rest\s*:?\s*([^,;]+)/i)
  if (r) restTime = r[1].trim()
  const w = rest.match(/@\s*([^,;]+)/)
  if (w) weight = w[1].trim()
  let leftover = vol || r || w ? '' : rest
  // "40 m", "5 min", "30 s" with no sets: that's the amount
  if (leftover && /^\d/.test(leftover) && leftover.length <= 20) { reps = leftover; leftover = '' }
  const out: PlanExercise = { name: leftover ? `${name} – ${leftover}` : name, sets, reps, rest: restTime, note }
  if (weight) out.weight = weight
  return out
}

// Reads a text plan's day headings and "-" lines. "Day 1, Day 2…" are placed on the client's
// available days in order (or Mon, Tue… if none). Returns null when no day headings are found.
export function textToPlan(text: string, availableDays?: string | null): PlanJson | null {
  const avail = (availableDays || '').split(',').map(d => d.trim()).filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d))
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean)
  const days: { day: Weekday | null; num: number | null; focus: string; rest: boolean; exercises: PlanExercise[] }[] = []
  let note = ''
  for (const line of lines) {
    if (/^note:/i.test(line)) { note = line.replace(/^note:\s*/i, ''); continue }
    const m = line.match(HEADING)
    if (m && !/^[-•*]/.test(line)) {
      let day: Weekday | null = DAY_WORDS[m[1].toLowerCase()] ?? null
      let focus = m[3] || ''
      const inner = focus.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s*(?:[–—:\-]\s*)?(.*)$/i)
      if (inner) { day = DAY_WORDS[inner[1].toLowerCase()]; focus = inner[2] }
      focus = focus.replace(/\(.*?\)/g, '').replace(/[:\s]+$/, '').trim()
      const rest = /\brest\b/i.test(line)
      days.push({ day, num: m[2] ? parseInt(m[2]) : null, focus: rest ? '' : focus, rest, exercises: [] })
      continue
    }
    if (/^[-•*]/.test(line) && days.length) days[days.length - 1].exercises.push(parseExerciseLine(line))
  }
  if (!days.length) return null
  const used = new Set(days.map(d => d.day).filter(Boolean) as Weekday[])
  const pool = (avail.length ? avail : [...WEEKDAYS]).filter(d => !used.has(d))
  const spare = [...WEEKDAYS].filter(d => !used.has(d) && !pool.includes(d))
  for (const d of days) {
    if (!d.day) { d.day = pool.shift() ?? spare.shift() ?? null; if (d.day) used.add(d.day) }
  }
  return normalizePlan({ days: days.filter(d => d.day), note })
}

// Reads plan_json from a database row (null for text-only plans or anything malformed)
export function planJsonOf(row: { plan_json?: unknown }): PlanJson | null {
  return row.plan_json ? normalizePlan(row.plan_json) : null
}

// Compact-card summary for any plan: from the structure when there is one, else from the text
export function summarizeAny(row: { plan_details: string; plan_json?: unknown }, weekStart?: string): PlanSummary {
  const plan = planJsonOf(row)
  if (!plan) return summarizePlan(row.plan_details)
  const days = weekStart ? daysInWeekOrder(plan, weekStart) : plan.days
  return {
    days: days.map(dayLabel),
    workoutDays: workoutDays(plan).length,
    exercises: plan.days.reduce((n, d) => n + d.exercises.length, 0),
    fallback: [],
  }
}

// What a client ticked off on a day, saved with the session (logged_sessions.exercises_done)
export type ExercisesDone = { done: string[]; total: number }

// Ticked positions -> names to save
export function exercisesDoneFor(day: PlanDay, ticked: number[]): ExercisesDone {
  return { done: day.exercises.filter((_, i) => ticked.includes(i)).map(e => e.name), total: day.exercises.length }
}

// Positions on an older copy of a day -> positions on the edited day, matched by exercise name (the n-th
// "Squat" goes to the n-th "Squat"). Exercises no longer in the day are left out of the map.
// Used for the coach's unsaved ticks / weights when the plan is edited mid-workout (17 Nov).
export function remapPositions(oldNames: string[], newNames: string[]): Map<number, number> {
  const used = new Set<number>()
  const map = new Map<number, number>()
  oldNames.forEach((name, i) => {
    const j = newNames.findIndex((n, k) => n === name && !used.has(k))
    if (j >= 0) { used.add(j); map.set(i, j) }
  })
  return map
}

// Saved names -> positions to show as ticked (matched by name, so a later plan edit can't misplace them)
export function tickedFromSaved(day: PlanDay, saved: unknown): number[] {
  const names = saved && typeof saved === 'object' && Array.isArray((saved as ExercisesDone).done) ? (saved as ExercisesDone).done : []
  const left = [...names]
  const out: number[] = []
  day.exercises.forEach((e, i) => {
    const k = left.indexOf(e.name)
    if (k >= 0) { out.push(i); left.splice(k, 1) }
  })
  return out
}

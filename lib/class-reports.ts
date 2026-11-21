// Dojo class reports (db/2026-11-19-dojo-activities-absences.md): what each class did, what each student did, how
// often each activity was done, and grading readiness (activity counts next to the existing belt minimums).
// A student "did" an activity when they were present in a class (any batch) whose class row ticked it (not removed).
// Present marks from before activities existed (no class row) count as classes attended with no activities.
// Absences follow the same rules as the absentee list (lib/absences.ts): an expected day (home batch ∩ availability),
// no holiday, not on leave, not present anywhere, and the home batch's class logged that day.
// Pure helpers, no Supabase calls, so scripts/check-class-reports.ts can run them. Dates are 'YYYY-MM-DD' strings.

import { type Batch, sortBatches } from './batches'
import { type AttendanceRow, batchesOn, weekdayOf, addDays } from './attendance'
import { type StudentLeave, leaveOn, expectedDays } from './leave'
import { type Holiday, holidayFor } from './holidays'
import { type DojoActivity, sortActivities } from './dojo-activities'
import { type BeltRank, type Eligibility, eligibility } from './belts'

export type ReportClass = { id: string; batch_id: string; class_date: string; logged_at: string | null }
export type ReportClassActivity = { class_id: string; activity_id: string; activity_name: string; removed_at: string | null }
type RBatch = Pick<Batch, 'id' | 'branch_id' | 'name' | 'days' | 'start_time' | 'is_archived'>

const key = (batchId: string, date: string) => `${batchId}|${date}`

// One look-up for the period: (batch, day) → the class row and its ticked activities (removed ones left out)
export type ClassIndex = Map<string, { cls: ReportClass; activities: { id: string; name: string }[] }>
export function indexClasses(classes: ReportClass[], acts: ReportClassActivity[]): ClassIndex {
  const byClass = new Map<string, { id: string; name: string }[]>()
  for (const a of acts) {
    if (a.removed_at) continue
    byClass.set(a.class_id, [...(byClass.get(a.class_id) || []), { id: a.activity_id, name: a.activity_name }])
  }
  const index: ClassIndex = new Map()
  for (const c of classes) index.set(key(c.batch_id, c.class_date), { cls: c, activities: byClass.get(c.id) || [] })
  return index
}

// (batch, day) pairs that were logged: someone present there, or the class row has logged_at
export function loggedDays(attendance: AttendanceRow[], classes: ReportClass[]): Set<string> {
  const s = new Set<string>()
  for (const r of attendance) if (r.present) s.add(key(r.batch_id, r.class_date))
  for (const c of classes) if (c.logged_at) s.add(key(c.batch_id, c.class_date))
  return s
}

// ── 1. By day ──────────────────────────────────────────────────────────────────────────────────────────────

export type DayRow<B extends RBatch = RBatch> = { batch: B; present: number; logged: boolean; activities: string[]; holiday: string | null; extra: boolean }

// Every batch meeting that day (plus any with someone marked present: an extra class), by start time
export function dayReport<B extends RBatch>(opts: { date: string; batches: B[]; attendance: AttendanceRow[]; index: ClassIndex; holidays: Holiday[] }): DayRow<B>[] {
  const present = opts.attendance.filter(r => r.present && r.class_date === opts.date)
  const meeting = new Set(batchesOn(opts.batches, opts.date).map(b => b.id))
  const used = new Set(present.map(r => r.batch_id))
  return sortBatches(opts.batches.filter(b => meeting.has(b.id) || used.has(b.id))).map(batch => {
    const c = opts.index.get(key(batch.id, opts.date))
    const n = new Set(present.filter(r => r.batch_id === batch.id).map(r => r.profile_id)).size
    return {
      batch, present: n, logged: n > 0 || !!c?.cls.logged_at, activities: (c?.activities || []).map(a => a.name),
      holiday: holidayFor(opts.holidays, batch.branch_id, opts.date)?.name ?? null, extra: !meeting.has(batch.id),
    }
  })
}

// ── 2. By student ──────────────────────────────────────────────────────────────────────────────────────────

export type DayStatus = 'came' | 'absent' | 'leave' | 'holiday' | 'not-logged' | 'off' | 'future' | 'before-join'
export type StudentDay = { date: string; status: DayStatus; activities: string[] }

export type ReportStudent = { id: string; full_name: string; batch_id?: string | null; branch_id?: string | null; available_days?: string | null; created_at?: string | null }

// One student's days from..to: came (with that day's activities, from every class they were present in), absent,
// on leave, holiday, not logged yet, not their day ('off'), after today ('future'), before they joined
export function studentDays(opts: {
  student: ReportStudent
  homeBatch: RBatch | null | undefined
  from: string
  to: string
  today: string
  attendance: AttendanceRow[]     // the gym's present rows in the period (for "logged") — the student's are picked here
  logged: Set<string>
  index: ClassIndex
  leaves: StudentLeave[]
  holidays: Holiday[]
}): StudentDay[] {
  const mine = opts.attendance.filter(r => r.present && r.profile_id === opts.student.id)
  const joined = (opts.student.created_at || '').slice(0, 10)
  const expected = opts.homeBatch ? expectedDays(opts.student.available_days, opts.homeBatch.days) : []
  const out: StudentDay[] = []
  for (let d = opts.from; d <= opts.to; d = addDays(d, 1)) {
    const here = mine.filter(r => r.class_date === d)
    if (here.length) {
      const names: string[] = []
      for (const r of here) for (const a of opts.index.get(key(r.batch_id, d))?.activities || []) if (!names.includes(a.name)) names.push(a.name)
      out.push({ date: d, status: 'came', activities: names })
      continue
    }
    let status: DayStatus
    if (d > opts.today) status = 'future'
    else if (joined && d < joined) status = 'before-join'
    else if (!opts.homeBatch || opts.homeBatch.is_archived || !expected.includes(weekdayOf(d) as never)) status = 'off'
    else if (holidayFor(opts.holidays, opts.student.branch_id || opts.homeBatch.branch_id, d)) status = 'holiday'
    else if (leaveOn(opts.leaves, opts.student.id, d)) status = 'leave'
    else if (!opts.logged.has(key(opts.homeBatch.id, d))) status = 'not-logged'
    else status = 'absent'
    out.push({ date: d, status, activities: [] })
  }
  return out
}

// Totals for the period: classes came, absences, leave days, and how many times each activity was done (most first)
export function studentTotals(days: StudentDay[]): { came: number; absent: number; leave: number; activities: { name: string; count: number }[] } {
  const counts = new Map<string, number>()
  for (const d of days) for (const a of d.activities) counts.set(a, (counts.get(a) || 0) + 1)
  return {
    came: days.filter(d => d.status === 'came').length,
    absent: days.filter(d => d.status === 'absent').length,
    leave: days.filter(d => d.status === 'leave').length,
    activities: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

// ── 3. By activity ─────────────────────────────────────────────────────────────────────────────────────────

export type ActivityRow<B extends RBatch = RBatch> = {
  activity: { id: string; name: string; archived: boolean }
  total: number
  last: string | null
  batches: { batch: B; count: number; last: string | null }[]
}

// Each activity: how many classes did it in the period, per batch (most first), and when it was last done
export function activityReport<B extends RBatch>(opts: { activities: DojoActivity[]; batches: B[]; index: ClassIndex; from: string; to: string }): ActivityRow<B>[] {
  const per = new Map<string, Map<string, { count: number; last: string }>>()
  for (const { cls, activities } of opts.index.values()) {
    if (cls.class_date < opts.from || cls.class_date > opts.to) continue
    for (const a of activities) {
      const m = per.get(a.id) || new Map<string, { count: number; last: string }>()
      const cur = m.get(cls.batch_id) || { count: 0, last: '' }
      m.set(cls.batch_id, { count: cur.count + 1, last: cls.class_date > cur.last ? cls.class_date : cur.last })
      per.set(a.id, m)
    }
  }
  return sortActivities(opts.activities)
    .filter(a => !a.is_archived || per.has(a.id))
    .map(a => {
      const m = per.get(a.id) || new Map()
      const batches = opts.batches.filter(b => m.has(b.id))
        .map(batch => ({ batch, count: m.get(batch.id)!.count, last: m.get(batch.id)!.last || null }))
        .sort((x, y) => y.count - x.count || x.batch.name.localeCompare(y.batch.name))
      const last = batches.reduce<string | null>((l, b) => (b.last && (!l || b.last > l) ? b.last : l), null)
      return { activity: { id: a.id, name: a.name, archived: a.is_archived }, total: batches.reduce((n, b) => n + b.count, 0), last, batches }
    })
}

// ── 4. Grading readiness ───────────────────────────────────────────────────────────────────────────────────

export type ReadinessRow<S extends ReportStudent = ReportStudent> = {
  student: S
  eligibility: Eligibility
  since: string | null                  // counted from: the belt date, else the join date
  classes: number                       // classes attended since then (one per day)
  activities: Record<string, number>    // activity id → times done since then
}

// The existing belt rule (months on the current belt, lib/belts.ts eligibility, to `asOf`) next to classes attended
// and activity counts since the belt date (or the join date when it's missing). No new rule: information only.
export function readiness<S extends ReportStudent & { current_rank_id?: string | null; rank_achieved_on?: string | null }>(opts: {
  students: S[]
  ranks: BeltRank[]
  attendance: AttendanceRow[]
  index: ClassIndex
  asOf: string
}): ReadinessRow<S>[] {
  return opts.students.filter(s => s.current_rank_id).map(s => {
    const e = eligibility({ ranks: opts.ranks, currentRankId: s.current_rank_id, achievedOn: s.rank_achieved_on, examDate: opts.asOf })
    const since = (s.rank_achieved_on || s.created_at || '').slice(0, 10) || null
    const rows = opts.attendance.filter(r => r.present && r.profile_id === s.id && (!since || r.class_date >= since) && r.class_date <= opts.asOf)
    const activities: Record<string, number> = {}
    const seen = new Set<string>()
    for (const r of rows) {
      for (const a of opts.index.get(key(r.batch_id, r.class_date))?.activities || []) {
        const k = `${r.class_date}|${a.id}`   // once per day even if two classes did it
        if (seen.has(k)) continue
        seen.add(k)
        activities[a.id] = (activities[a.id] || 0) + 1
      }
    }
    return { student: s, eligibility: e, since, classes: new Set(rows.map(r => r.class_date)).size, activities }
  }).sort((a, b) => readyOrder(a.eligibility) - readyOrder(b.eligibility) || a.student.full_name.localeCompare(b.student.full_name))
}

// Eligible first, then not yet, then highest belt / no belt
const readyOrder = (e: Eligibility) => (e.kind === 'eligible' ? 0 : e.kind === 'not-yet' ? 1 : 2)

// ── 5. One student, month by month ─────────────────────────────────────────────────────────────────────────

export const HISTORY_MONTHS = 6

export type MonthSummary = {
  month: string          // 'YYYY-MM-01'
  soFar: boolean         // the current month (counted up to today)
  came: number
  of: number             // classes they had: came + absent (holidays, leave, off days and not-logged days left out)
  absent: number
  leave: number
  activities: { name: string; count: number }[]   // times done, most first
}

const firstOf = (d: string) => `${d.slice(0, 7)}-01`
const shift = (monthIso: string, n: number) => {
  const [y, m] = monthIso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`
}
const lastOf = (monthIso: string) => addDays(shift(monthIso, 1), -1)

// The months to show: this month back to the month they joined, at most `months`, newest first
export function historyMonths(today: string, joined: string | null | undefined, months = HISTORY_MONTHS): string[] {
  const out: string[] = []
  const stop = joined ? firstOf(joined.slice(0, 10)) : null
  for (let i = 0, m = firstOf(today); i < months; i++, m = shift(m, -1)) {
    if (stop && m < stop) break
    out.push(m)
  }
  return out
}

// The range to read for those months (first day of the oldest to today)
export function historyRange(today: string, joined: string | null | undefined, months = HISTORY_MONTHS): { from: string; to: string } {
  const list = historyMonths(today, joined, months)
  return { from: list[list.length - 1] ?? firstOf(today), to: today }
}

// Month by month for one student, with the same day rules as the calendar (studentDays) and the absentee list
export function monthSummaries(opts: Omit<Parameters<typeof studentDays>[0], 'from' | 'to'> & { months?: number }): MonthSummary[] {
  return historyMonths(opts.today, opts.student.created_at, opts.months).map(month => {
    const to = lastOf(month) < opts.today ? lastOf(month) : opts.today
    const days = studentDays({ ...opts, from: month, to })
    const t = studentTotals(days)
    return { month, soFar: to === opts.today && lastOf(month) > opts.today, came: t.came, of: t.came + t.absent, absent: t.absent, leave: t.leave, activities: t.activities }
  })
}

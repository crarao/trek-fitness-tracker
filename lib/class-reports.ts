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
import { type DojoActivity, sortActivities, appliesToBelt, categoriesOf, itemsOf } from './dojo-activities'
import { type BeltRank, type Eligibility, eligibility } from './belts'

// Items by belt (db/2026-11-20-activity-items.md): an item ticked on a class counts for a student only when their
// belt ON THE CLASS DATE is the item's belt or higher. Without this (no items, no belts) everything counts.
export type BeltScope = {
  activities: Pick<DojoActivity, 'id' | 'parent_id' | 'min_rank_id'>[]
  ranks: Pick<BeltRank, 'id' | 'rank_order'>[]
  rankOn: (studentId: string, date: string) => string | null | undefined
}
const counts = (scope: BeltScope | undefined, activityId: string, studentId: string, date: string) => {
  if (!scope) return true
  const a = scope.activities.find(x => x.id === activityId)
  return appliesToBelt(a?.min_rank_id, scope.rankOn(studentId, date), scope.ranks)
}

// The student's belt on a date from the belt history (student_grades): the latest change dated on or before it
// (achieved_on, else the day it was entered); before the first change, the earliest belt on record; no history =
// the current belt. Undone (voided) rows are ignored.
export function beltOnDate(
  history: { student_id: string; rank_id: string; achieved_on: string | null; created_at: string; voided_at?: string | null }[],
  studentId: string, date: string, currentRankId: string | null | undefined,
): string | null {
  const rows = history.filter(h => h.student_id === studentId && !h.voided_at)
    .map(h => ({ ...h, day: (h.achieved_on || h.created_at).slice(0, 10) }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.created_at.localeCompare(b.created_at))
  if (!rows.length) return currentRankId ?? null
  const upTo = rows.filter(r => r.day <= date)
  return (upTo.length ? upTo[upTo.length - 1] : rows[0]).rank_id
}

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
export type StudentDay = { date: string; status: DayStatus; activities: string[]; ids?: string[] }

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
  scope?: BeltScope
}): StudentDay[] {
  const mine = opts.attendance.filter(r => r.present && r.profile_id === opts.student.id)
  const joined = (opts.student.created_at || '').slice(0, 10)
  const expected = opts.homeBatch ? expectedDays(opts.student.available_days, opts.homeBatch.days) : []
  const out: StudentDay[] = []
  for (let d = opts.from; d <= opts.to; d = addDays(d, 1)) {
    const here = mine.filter(r => r.class_date === d)
    if (here.length) {
      const names: string[] = []
      const ids: string[] = []
      for (const r of here) {
        for (const a of opts.index.get(key(r.batch_id, d))?.activities || []) {
          if (ids.includes(a.id) || !counts(opts.scope, a.id, opts.student.id, d)) continue
          ids.push(a.id); names.push(a.name)
        }
      }
      out.push({ date: d, status: 'came', activities: names, ids })
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
  scope?: BeltScope
}): ReadinessRow<S>[] {
  return opts.students.filter(s => s.current_rank_id).map(s => {
    const e = eligibility({ ranks: opts.ranks, currentRankId: s.current_rank_id, achievedOn: s.rank_achieved_on, examDate: opts.asOf })
    const since = (s.rank_achieved_on || s.created_at || '').slice(0, 10) || null
    const rows = opts.attendance.filter(r => r.present && r.profile_id === s.id && (!since || r.class_date >= since) && r.class_date <= opts.asOf)
    const activities: Record<string, number> = {}
    const seen = new Set<string>()
    for (const r of rows) {
      for (const a of opts.index.get(key(r.batch_id, r.class_date))?.activities || []) {
        if (!counts(opts.scope, a.id, s.id, r.class_date)) continue
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

// ── Categories with items: totals rolled up ────────────────────────────────────────────────────────────────

export type TreeTotal = { id: string; name: string; count: number; items: { id: string; name: string; count: number }[] }

// One student's period as categories → items. A category counts a day when the category itself or any of its items
// was done that day (so "Kata practice 22×" includes the days only a specific kata was ticked). Zero rows left out.
export function treeTotals(days: StudentDay[], activities: DojoActivity[]): TreeTotal[] {
  const dayIds = days.filter(d => d.status === 'came').map(d => new Set(d.ids || []))
  const n = (ids: string[]) => dayIds.filter(s => ids.some(id => s.has(id))).length
  return categoriesOf(activities).map(c => {
    const items = itemsOf(activities, c.id).map(i => ({ id: i.id, name: i.name, count: n([i.id]) })).filter(i => i.count > 0)
    return { id: c.id, name: c.name, count: n([c.id, ...itemsOf(activities, c.id).map(i => i.id)]), items }
  }).filter(t => t.count > 0)
}

// The items a student is learning for their next grading: those first taught at their current belt
export function syllabusFor<T extends Pick<DojoActivity, 'id' | 'name' | 'parent_id' | 'min_rank_id' | 'is_archived' | 'sort_order'>>(activities: T[], currentRankId: string | null | undefined): T[] {
  if (!currentRankId) return []
  return sortActivities(activities.filter(a => a.parent_id && !a.is_archived && a.min_rank_id === currentRankId))
}

// The by-activity report as categories → items. A category's numbers are rolled up: classes that ticked the
// category or any of its items.
export function activityTree<B extends RBatch>(opts: { activities: DojoActivity[]; batches: B[]; index: ClassIndex; from: string; to: string }): (ActivityRow<B> & { items: ActivityRow<B>[] })[] {
  const flat = activityReport(opts)
  const byId = new Map(flat.map(r => [r.activity.id, r]))
  const rolled = (ids: string[]): Omit<ActivityRow<B>, 'activity'> => {
    const per = new Map<string, { count: number; last: string }>()
    for (const { cls, activities } of opts.index.values()) {
      if (cls.class_date < opts.from || cls.class_date > opts.to || !activities.some(a => ids.includes(a.id))) continue
      const cur = per.get(cls.batch_id) || { count: 0, last: '' }
      per.set(cls.batch_id, { count: cur.count + 1, last: cls.class_date > cur.last ? cls.class_date : cur.last })
    }
    const batches = opts.batches.filter(b => per.has(b.id)).map(batch => ({ batch, count: per.get(batch.id)!.count, last: per.get(batch.id)!.last || null }))
      .sort((x, y) => y.count - x.count || x.batch.name.localeCompare(y.batch.name))
    return { total: batches.reduce((n, b) => n + b.count, 0), last: batches.reduce<string | null>((l, b) => (b.last && (!l || b.last > l) ? b.last : l), null), batches }
  }
  return categoriesOf(opts.activities).filter(c => byId.has(c.id)).map(c => {
    const items = itemsOf(opts.activities, c.id).map(i => byId.get(i.id)).filter((r): r is ActivityRow<B> => !!r)
    return { ...byId.get(c.id)!, ...rolled([c.id, ...items.map(i => i.activity.id)]), items }
  })
}

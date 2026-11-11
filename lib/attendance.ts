// Attendance (Dojo Build 3, ROADMAP #78; table in db/2026-11-03-attendance.md).
// A sensei (or the owner / a partner) opens a batch's class for a day and taps who came; not tapped = absent.
// Students from another batch can be added as drop-ins. For dojos this replaces "Log session": the Progress tab and
// the parent's WhatsApp update count classes attended.
// Pure helpers, no Supabase calls, so scripts/check-attendance.ts can run them. Dates are plain 'YYYY-MM-DD' strings.

import { type Country, formatDate, parseDate } from './locale'
import { type Batch, WEEKDAYS, sortBatches, sortDays } from './batches'
import { pickRecipient } from './guardian'
import { waDigits } from './phone'

export type AttendanceRow = {
  id?: string
  company_id?: string
  batch_id: string
  profile_id: string
  class_date: string
  present: boolean
  is_drop_in: boolean
  marked_by?: string | null
  marked_at?: string | null
}
export const ATTENDANCE_COLUMNS = 'id, company_id, batch_id, profile_id, class_date, present, is_drop_in, marked_by, marked_at'

export type RosterStudent = { id: string; full_name: string; batch_id?: string | null; archived_at?: string | null; current_rank_id?: string | null }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function addDays(dateIso: string, n: number): string {
  const d = parseDate(dateIso)
  d.setDate(d.getDate() + n)
  return iso(d)
}

// 'Mon' … 'Sun' for a date
export function weekdayOf(dateIso: string): string {
  return WEEKDAYS[(parseDate(dateIso).getDay() + 6) % 7]
}

// Active batches that meet on this date, by start time
export function batchesOn<T extends Pick<Batch, 'days' | 'is_archived' | 'name' | 'start_time'>>(batches: T[], dateIso: string): T[] {
  const day = weekdayOf(dateIso)
  return sortBatches(batches.filter(b => !b.is_archived && sortDays(b.days).includes(day as never)))
}

// Every date from..to (inclusive) on which these weekdays fall
export function scheduledDates(days: readonly string[] | null | undefined, fromIso: string, toIso: string): string[] {
  const want = new Set(sortDays(days))
  const out: string[] = []
  if (!want.size || fromIso > toIso) return out
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) if (want.has(weekdayOf(d) as never)) out.push(d)
  return out
}

// The class list for one batch on one day: home-batch students (tapped or not) and drop-ins who came
export function roster(opts: {
  batchId: string
  date: string
  students: RosterStudent[]       // the gym's active students
  rows: AttendanceRow[]           // attendance rows (any batch / day; filtered here)
}): {
  home: { student: RosterStudent; present: boolean }[]
  dropIns: RosterStudent[]
  came: number
} {
  const day = opts.rows.filter(r => r.batch_id === opts.batchId && r.class_date === opts.date)
  const presentIds = new Set(day.filter(r => r.present).map(r => r.profile_id))
  const active = opts.students.filter(s => !s.archived_at)
  const home = active
    .filter(s => s.batch_id === opts.batchId)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map(student => ({ student, present: presentIds.has(student.id) }))
  const homeIds = new Set(home.map(h => h.student.id))
  const dropIns = active
    .filter(s => !homeIds.has(s.id) && presentIds.has(s.id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
  return { home, dropIns, came: home.filter(h => h.present).length + dropIns.length }
}

// The row to save when a student is tapped: present flips; is_drop_in when it isn't their home batch
export function tapRow(opts: { batchId: string; date: string; student: RosterStudent; companyId: string; current: boolean; markedBy: string }): AttendanceRow & { company_id: string; marked_by: string; marked_at: string } {
  return {
    company_id: opts.companyId,
    batch_id: opts.batchId,
    profile_id: opts.student.id,
    class_date: opts.date,
    present: !opts.current,
    is_drop_in: opts.student.batch_id !== opts.batchId,
    marked_by: opts.markedBy,
    marked_at: new Date().toISOString(),
  }
}

// Days a student came (any batch), newest first, one per day
export function attendedDates(profileId: string, rows: AttendanceRow[], fromIso?: string, toIso?: string): string[] {
  const set = new Set(rows.filter(r => r.profile_id === profileId && r.present
    && (!fromIso || r.class_date >= fromIso) && (!toIso || r.class_date <= toIso)).map(r => r.class_date))
  return [...set].sort().reverse()
}

// First and last day of the month that contains dateIso
export function monthRange(dateIso: string): { from: string; to: string } {
  const d = parseDate(dateIso)
  return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
}

// "9 of 12 classes": days attended in the month (any batch) vs classes of their home batch so far
// (scheduled up to today, or to the month's end for a past month). Without a home batch: attended only.
export function monthStats(opts: {
  profileId: string
  homeBatch: Pick<Batch, 'days'> | null | undefined
  rows: AttendanceRow[]
  month: string          // any date in the month
  today: string
  since?: string | null  // the day they joined (profiles.created_at): classes before it aren't counted as missed
}): { attended: number; scheduled: number | null; from: string; to: string } {
  const { from, to } = monthRange(opts.month)
  const until = to < opts.today ? to : opts.today
  const dates = attendedDates(opts.profileId, opts.rows, from, until)
  // Count from the day they joined, or their first class this month if that's earlier
  // (staff often add a student and then mark the days they already came: "3 of 1" otherwise)
  const joined = (opts.since || '').slice(0, 10)
  const firstClass = dates.length ? dates[dates.length - 1] : ''
  const earliest = joined && firstClass && firstClass < joined ? firstClass : joined
  const start = earliest && earliest > from ? earliest : from
  const attended = dates.length
  const scheduled = opts.homeBatch ? scheduledDates(opts.homeBatch.days, start, until).length : null
  return { attended, scheduled, from, to }
}

export const statsText = (s: { attended: number; scheduled: number | null }) =>
  // More than scheduled (drop-ins on other days): just the count, never "4 of 3"
  s.scheduled != null && s.scheduled > 0 && s.attended <= s.scheduled
    ? `${s.attended} of ${s.scheduled} class${s.scheduled === 1 ? '' : 'es'}`
    : `${s.attended} class${s.attended === 1 ? '' : 'es'}`

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || ''

// WhatsApp attendance update for the parent (or the student when there's no parent), like the progress share
export function buildAttendanceMessage(opts: {
  client: { full_name: string; phone: string | null; guardian_name?: string | null; guardian_relation?: string | null; guardian_phone?: string | null }
  companyName: string
  staffName?: string | null
  rows: AttendanceRow[]
  homeBatch: Pick<Batch, 'days' | 'name'> | null | undefined
  today: string
  month?: string        // any date in the month to report; default this month
  since?: string | null // the day they joined (see monthStats)
  note?: string
  country: Country | null
}): { text: string; toPhone: string | null; toLabel: string } {
  const { client, country } = opts
  const to = pickRecipient(client, raw => waDigits(raw, country))
  const kid = firstName(client.full_name)
  const greet = to.toParent ? firstName(client.guardian_name) || 'there' : kid || 'there'
  const monthOf = opts.month ?? opts.today
  const stats = monthStats({ profileId: '__self', homeBatch: opts.homeBatch, rows: opts.rows.map(r => ({ ...r, profile_id: '__self' })), month: monthOf, today: opts.today, since: opts.since })
  const pastMonth = stats.to < opts.today
  const monthName = formatDate(stats.from, country, 'monthLong')
  const dates = attendedDates('__self', opts.rows.map(r => ({ ...r, profile_id: '__self' })), stats.from, stats.to < opts.today ? stats.to : opts.today)
  const out: string[] = []
  out.push(to.toParent ? `Hi ${greet}, here's ${kid}'s attendance at ${opts.companyName}` : `Hi ${greet}, here's your attendance at ${opts.companyName}`)
  out.push(`${monthName}${opts.homeBatch?.name ? ` · ${opts.homeBatch.name}` : ''}`)
  out.push('', `✅ ${statsText(stats)} attended`)
  if (dates.length) out.push(`Last class: ${formatDate(dates[0], country, 'weekday')}`)
  else out.push(pastMonth ? `No classes attended in ${monthName}.` : `No classes attended yet this month. We hope to see ${to.toParent ? 'them' : 'you'} soon!`)
  const note = (opts.note || '').trim()
  if (note) out.push('', note)
  out.push('', `🥋 — ${[firstName(opts.staffName), opts.companyName].filter(Boolean).join(', ')}`)
  const name = (client.guardian_name || '').trim()
  const relation = (client.guardian_relation || '').trim()
  const toLabel = to.toParent ? (relation && name ? `${relation} (${name})` : relation || name || 'Parent') : client.full_name
  return { text: out.join('\n'), toPhone: to.phone, toLabel }
}

// ── One shared view of the day (attendance across every batch) ──────────────────────────────────────────────
// A student may come to two classes on one day (exam week, an extra class), so a second mark is allowed, but the
// screens warn: "Already came today · Kids 5 PM · by Sensei Ravi". No database rule blocks it.

// The student's present rows on this date in batches other than this one
export function cameElsewhere(rows: AttendanceRow[], profileId: string, batchId: string, date: string): AttendanceRow[] {
  return rows.filter(r => r.present && r.profile_id === profileId && r.class_date === date && r.batch_id !== batchId)
}

// "Kids 5 PM · by Sensei Ravi" for each other batch the student came to (batch names / who marked it, when known)
export function elsewhereText(
  others: AttendanceRow[],
  batchName: (id: string) => string,
  markedByName: (id: string | null | undefined) => string,
): string {
  return others.map(r => [batchName(r.batch_id), markedByName(r.marked_by) ? `by ${markedByName(r.marked_by)}` : ''].filter(Boolean).join(' · ')).join('; ')
}

export type DayEntry = {
  student: RosterStudent
  present: boolean
  dropIn: boolean              // came, but this isn't their home batch
  markedBy: string | null      // who marked this batch's row
  elsewhere: AttendanceRow[]   // present in other batches the same day
}

// Every batch on the day, each with its home students and the drop-ins who came. Batches that don't usually meet
// that day still show when someone was marked in them (an extra class). A student who came to two batches shows in
// both, with `elsewhere` filled in. `came` counts each student once; `twice` = students marked in 2+ batches.
export function dayBoard<B extends Pick<Batch, 'id' | 'days' | 'is_archived' | 'name' | 'start_time'>>(opts: {
  date: string
  batches: B[]
  students: RosterStudent[]
  rows: AttendanceRow[]
}): { groups: { batch: B; entries: DayEntry[]; came: number; extra: boolean }[]; came: number; twice: number } {
  const day = opts.rows.filter(r => r.class_date === opts.date)
  const present = day.filter(r => r.present)
  const meeting = new Set(batchesOn(opts.batches, opts.date).map(b => b.id))
  const used = new Set(present.map(r => r.batch_id))
  const shown = sortBatches(opts.batches.filter(b => meeting.has(b.id) || used.has(b.id)))
  const active = opts.students.filter(s => !s.archived_at)
  const groups = shown.map(batch => {
    const here = day.filter(r => r.batch_id === batch.id)
    const ro = roster({ batchId: batch.id, date: opts.date, students: active, rows: here })
    const entry = (student: RosterStudent, isPresent: boolean, dropIn: boolean): DayEntry => ({
      student, present: isPresent, dropIn,
      markedBy: here.find(r => r.profile_id === student.id)?.marked_by ?? null,
      elsewhere: cameElsewhere(present, student.id, batch.id, opts.date),
    })
    const entries = [...ro.home.map(h => entry(h.student, h.present, false)), ...ro.dropIns.map(s => entry(s, true, true))]
    return { batch, entries, came: ro.came, extra: !meeting.has(batch.id) }
  })
  const activeIds = new Set(active.map(s => s.id))
  const perStudent = new Map<string, Set<string>>()
  for (const r of present) {
    if (!activeIds.has(r.profile_id) || !shown.some(b => b.id === r.batch_id)) continue
    perStudent.set(r.profile_id, (perStudent.get(r.profile_id) || new Set()).add(r.batch_id))
  }
  return { groups, came: perStudent.size, twice: [...perStudent.values()].filter(s => s.size > 1).length }
}

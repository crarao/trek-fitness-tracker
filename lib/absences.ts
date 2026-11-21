// Today's absentees + the absence WhatsApp (dojos; db/2026-11-19-dojo-activities-absences.md: message_templates).
// The owner / a partner opens the list (normally at the end of the day) from the dojo home. A student is absent today
// when ALL of these hold:
//   - today is one of their expected days: the home batch's days, narrowed by available_days (lib/leave.ts)
//   - no holiday today for their branch or for all branches (lib/holidays.ts)
//   - not on leave today (an active student_leaves row covering today)
//   - no present = true attendance today in ANY batch (a drop-in elsewhere counts as came)
//   - their home batch's class has been logged today (someone marked present there, or batch_classes.logged_at is
//     today). Batches not logged yet are left off the list and listed as "not taken yet".
// The message goes to the parent when their phone is valid, else the student (pickRecipient), opened with wa.me by
// hand; nothing records that it was sent. One English template per gym, edited by owner / partners; the greeting
// ("Namaste Priya 🙏" / "Hi Priya,") is always added in front (greet()).
// Pure helpers, no Supabase calls, so scripts/check-absences.ts can run them. Dates are 'YYYY-MM-DD' strings.

import { type Country, formatDate, greet } from './locale'
import { type Batch, sortBatches, timeLabel } from './batches'
import { type AttendanceRow, weekdayOf } from './attendance'
import { type StudentLeave, leaveOn, expectedDays } from './leave'
import { type Holiday, holidayFor } from './holidays'
import { pickRecipient } from './guardian'
import { waDigits } from './phone'

export type AbsenceStudent = {
  id: string
  full_name: string
  phone?: string | null
  branch_id?: string | null
  batch_id?: string | null
  available_days?: string | null
  archived_at?: string | null
  guardian_name?: string | null
  guardian_phone?: string | null
  guardian_relation?: string | null
}

type ClassRow = { batch_id: string; class_date: string; logged_at: string | null }
type AbsBatch = Pick<Batch, 'id' | 'branch_id' | 'name' | 'days' | 'start_time' | 'end_time' | 'is_archived'>

export type AbsenceGroup<B extends AbsBatch = AbsBatch> = { batch: B; students: AbsenceStudent[] }

// Who is absent today, by home batch (batches by start time, students by name). Also: the home batches expected
// today whose class isn't logged yet (with how many students they'd cover), and how many were left out for leave.
export function absenteesFor<B extends AbsBatch>(opts: {
  date: string
  students: AbsenceStudent[]
  batches: B[]
  attendance: AttendanceRow[]      // any rows (filtered here to present ones on the date)
  classes: ClassRow[]              // batch_classes rows (any; filtered here to the date)
  leaves: StudentLeave[]
  holidays: Holiday[]
}): { groups: AbsenceGroup<B>[]; notLogged: { batch: B; expected: number }[]; onLeave: number; total: number } {
  const { date } = opts
  const day = weekdayOf(date)
  const present = opts.attendance.filter(r => r.present && r.class_date === date)
  const came = new Set(present.map(r => r.profile_id))
  const batchLogged = (id: string) => present.some(r => r.batch_id === id)
    || opts.classes.some(c => c.batch_id === id && c.class_date === date && !!c.logged_at)
  const byBatch = new Map<string, AbsenceStudent[]>()
  const waiting = new Map<string, number>()
  let onLeave = 0
  for (const s of opts.students) {
    if (s.archived_at || !s.batch_id) continue
    const batch = opts.batches.find(b => b.id === s.batch_id)
    if (!batch || batch.is_archived) continue
    if (!expectedDays(s.available_days, batch.days).includes(day as never)) continue
    if (holidayFor(opts.holidays, s.branch_id || batch.branch_id, date)) continue
    if (leaveOn(opts.leaves, s.id, date)) { onLeave++; continue }
    if (came.has(s.id)) continue
    if (!batchLogged(batch.id)) { waiting.set(batch.id, (waiting.get(batch.id) || 0) + 1); continue }
    byBatch.set(batch.id, [...(byBatch.get(batch.id) || []), s])
  }
  const ordered = sortBatches(opts.batches.filter(b => byBatch.has(b.id) || waiting.has(b.id)))
  const groups = ordered.filter(b => byBatch.has(b.id))
    .map(batch => ({ batch, students: [...byBatch.get(batch.id)!].sort((a, b) => a.full_name.localeCompare(b.full_name)) }))
  const notLogged = ordered.filter(b => waiting.has(b.id)).map(batch => ({ batch, expected: waiting.get(batch.id)! }))
  return { groups, notLogged, onLeave, total: groups.reduce((n, g) => n + g.students.length, 0) }
}

// ── The message ────────────────────────────────────────────────────────────────────────────────────────────

export const PLACEHOLDERS = ['{child_name}', '{date}', '{batch_time}', '{dojo_name}'] as const
export const DEFAULT_ABSENCE_BODY =
  "{child_name} did not attend today's karate class ({date}, {batch_time} batch) at {dojo_name}. Please let us know if all is well."
// Yoga studios (21 Nov): the same placeholders, no "karate class"
export const YOGA_ABSENCE_BODY =
  "We missed {child_name} at today's yoga class ({date}, {batch_time} batch) at {dojo_name}. Hope all is well, see you at the next class."
// The standard message for the business type: yoga gets its own, everyone else (dojos) exactly DEFAULT_ABSENCE_BODY
export function defaultAbsenceBody(businessType?: string | null): string {
  return businessType === 'yoga' ? YOGA_ABSENCE_BODY : DEFAULT_ABSENCE_BODY
}
export const TEMPLATE_MAX = 1000

export function fillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{(child_name|date|batch_time|dojo_name)\}/g, (_, k: string) => vars[k] ?? '')
}

// {something} that isn't one of ours (a typo like {name}): shown as a warning in the editor, left as typed
export function unknownPlaceholders(body: string): string[] {
  const found = body.match(/\{[^{}\s]*\}/g) || []
  return [...new Set(found.filter(p => !(PLACEHOLDERS as readonly string[]).includes(p)))]
}

export function templateProblem(body: string): string {
  const b = body.trim()
  if (!b) return 'Write the message (or tap Use the standard message).'
  if (b.length > TEMPLATE_MAX) return `Keep the message under ${TEMPLATE_MAX} characters.`
  return ''
}

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || ''

// The WhatsApp for one absent student: greeting to the parent (or the student) + the filled template
export function absenceMessage(opts: {
  student: AbsenceStudent
  batch: Pick<Batch, 'start_time'> | null | undefined
  date: string
  companyName: string
  body?: string | null              // the gym's template; empty = the standard one
  country: Country | null
  businessType?: string | null      // picks the standard message when the gym has none (yoga / dojo)
}): { text: string; toPhone: string | null; toParent: boolean; toLabel: string } {
  const { student, country } = opts
  const to = pickRecipient(student, raw => waDigits(raw, country))
  const kid = firstName(student.full_name)
  const greetName = to.toParent ? firstName(student.guardian_name) || 'there' : kid || 'there'
  const vars = {
    child_name: kid || student.full_name,
    date: formatDate(opts.date, country, 'dayMonth'),
    batch_time: timeLabel(opts.batch?.start_time, country) || 'class',
    dojo_name: opts.companyName,
  }
  const body = (opts.body || '').trim() || defaultAbsenceBody(opts.businessType)
  const relation = (student.guardian_relation || '').trim()
  const parent = (student.guardian_name || '').trim()
  const toLabel = to.toParent ? (relation && parent ? `${relation} (${parent})` : relation || parent || 'Parent') : student.full_name
  return { text: greet(greetName, fillTemplate(body, vars), country), toPhone: to.phone, toParent: to.toParent, toLabel }
}

export const waLink = (digits: string, text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`

// ── Send to all: a guided run through the list ─────────────────────────────────────────────────────────────

export type RunState = { queue: string[]; index: number; opened: number; skipped: number }

export const startRun = (ids: string[]): RunState => ({ queue: ids, index: 0, opened: 0, skipped: 0 })
// After the current one was opened (sent) or skipped: move on
export const advance = (r: RunState, how: 'opened' | 'skipped'): RunState =>
  ({ ...r, index: r.index + 1, opened: r.opened + (how === 'opened' ? 1 : 0), skipped: r.skipped + (how === 'skipped' ? 1 : 0) })
export const runDone = (r: RunState) => r.index >= r.queue.length
export const runCurrent = (r: RunState): string | null => (runDone(r) ? null : r.queue[r.index])
// "3 of 12" (the one being shown, counting from 1)
export const runProgress = (r: RunState) => `${Math.min(r.index + 1, r.queue.length)} of ${r.queue.length}`
export const runSummary = (r: RunState) => `Done: ${r.opened} opened, ${r.skipped} skipped`

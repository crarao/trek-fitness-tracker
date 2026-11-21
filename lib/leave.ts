// Dojo leave + availability (db/2026-11-19-dojo-activities-absences.md: student_leaves; profiles.available_days).
// Leave: the owner, a partner or a sensei marks a student "On leave" from the roll call, from that day "until when?"
// (default the same day), with an optional note. Cancel = cancelled_at (never deleted, CLAUDE.md Rule #1).
// Availability: some students come only on some of their home batch's days ("Mon,Wed,Fri" in available_days, the
// same comma format gyms already use). Empty = every home batch day. Used later by the absentee list (lib/absences.ts).
// Pure helpers, no Supabase calls, so scripts/check-leave.ts can run them. Dates are 'YYYY-MM-DD' strings.

import { type Country, formatDate } from './locale'
import { type Weekday, WEEKDAYS, sortDays } from './batches'

export type StudentLeave = {
  id: string
  company_id?: string
  profile_id: string
  from_date: string
  to_date: string
  note: string | null
  marked_by?: string | null
  created_at?: string
  cancelled_at: string | null
  cancelled_by?: string | null
}
export const LEAVE_COLUMNS = 'id, company_id, profile_id, from_date, to_date, note, marked_by, created_at, cancelled_at, cancelled_by'
export const LEAVE_NOTE_MAX = 200

// The student's active leave covering this date (the one ending last when two overlap), or null
export function leaveOn(leaves: StudentLeave[], profileId: string, date: string): StudentLeave | null {
  const on = leaves.filter(l => l.profile_id === profileId && !l.cancelled_at && l.from_date <= date && l.to_date >= date)
  if (!on.length) return null
  return on.reduce((a, b) => (b.to_date > a.to_date ? b : a))
}

// "On leave today" / "On leave until 24 Nov" (seen from the roll call's date)
export function leaveText(leave: Pick<StudentLeave, 'to_date'>, date: string, country: Country | null): string {
  return leave.to_date === date ? 'On leave today' : `On leave until ${formatDate(leave.to_date, country, 'dayMonth')}`
}

// The sheet's check: "until" on or after the start, note not too long
export function leaveProblem(d: { from: string; to: string; note?: string }): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.to || '')) return 'Pick the last day of leave.'
  if (d.to < d.from) return "The last day can't be before the first."
  if ((d.note || '').trim().length > LEAVE_NOTE_MAX) return `Keep the note under ${LEAVE_NOTE_MAX} characters.`
  return ''
}

// The row to insert
export function leaveRow(opts: { companyId: string; profileId: string; from: string; to: string; note?: string; markedBy: string }) {
  return {
    company_id: opts.companyId, profile_id: opts.profileId, from_date: opts.from, to_date: opts.to,
    note: (opts.note || '').trim() || null, marked_by: opts.markedBy,
  }
}

// ── Availability ────────────────────────────────────────────────────────────────────────────────────────────

// "Mon,Wed,Fri" (also "mon, wednesday") → ['Mon', 'Wed', 'Fri']
export function parseDays(value: string | null | undefined): Weekday[] {
  const set = new Set((value || '').split(',').map(d => d.trim().slice(0, 3).toLowerCase()).filter(Boolean))
  return WEEKDAYS.filter(d => set.has(d.toLowerCase()))
}

// The days the student is expected: their home batch's days, narrowed to their availability when it's set and
// overlaps (an availability that misses every batch day, e.g. left over from before the batch changed, is ignored)
export function expectedDays(availableDays: string | null | undefined, batchDays: readonly string[] | null | undefined): Weekday[] {
  const batch = sortDays(batchDays)
  const avail = new Set(parseDays(availableDays))
  if (!avail.size) return batch
  const both = batch.filter(d => avail.has(d))
  return both.length ? both : batch
}

// What the profile picker saves: only home batch days; every batch day (or none) = null = "all of them"
export function availabilityValue(selected: readonly string[], batchDays: readonly string[] | null | undefined): string | null {
  const batch = sortDays(batchDays)
  const picked = sortDays(selected).filter(d => batch.includes(d))
  if (!picked.length || picked.length === batch.length) return null
  return picked.join(',')
}

// "Attends: Mon, Wed, Fri" when the student comes on fewer days than the batch meets; '' otherwise
export function attendsLabel(availableDays: string | null | undefined, batchDays: readonly string[] | null | undefined): string {
  const batch = sortDays(batchDays)
  const days = expectedDays(availableDays, batchDays)
  if (!batch.length || days.length === batch.length) return ''
  return `Attends: ${days.join(', ')}`
}

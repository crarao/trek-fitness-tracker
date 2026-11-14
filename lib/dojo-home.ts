// Dojo owner / partner home (/company when attendanceMode: a dojo with branches, batches and attendance).
// Pure helpers, no Supabase calls, so scripts/check-dojo-home.ts can run them with sample data.
// The membership rules (latestMembership, daysLeft, membershipStatus) moved here from app/company/page.tsx unchanged:
// the page imports them back, so the gym home gives exactly the same answers as before.
// Dates are plain 'YYYY-MM-DD' strings (device time, like the rest of the app).

import { type Country, parseDate } from './locale'
import { type Batch, timeLabel } from './batches'
import { type AttendanceRow } from './attendance'
import { FEE_REMINDER_DAYS } from './guardian'
import { PHONE_COUNTRIES, splitE164 } from './phone'
import { groupByCurrency, type Currency } from './currency'

// ---- Membership rules (moved from app/company/page.tsx) ----

export type MembershipLike = {
  plan_type?: string
  amount_paid: number
  start_date: string
  end_date: string
  created_at?: string
  currency?: string | null
}

export function latestMembership<M extends MembershipLike>(memberships: M[]): M | null {
  if (!memberships?.length) return null
  // Latest start date wins; if two start the same day, the most recently created one is current
  return [...memberships].sort((a, b) =>
    (b.start_date.localeCompare(a.start_date)) || ((b.created_at || '').localeCompare(a.created_at || ''))
  )[0]
}

// `today` only for the check script; the page calls it without (= now), exactly as before
export function daysLeft(endDate: string, today: Date = new Date()): number {
  const t = new Date(today)
  t.setHours(0, 0, 0, 0)
  const end = new Date(endDate)
  return Math.ceil((end.getTime() - t.getTime()) / (1000 * 60 * 60 * 24))
}

export function membershipStatus(m: MembershipLike | null, today: Date = new Date()): 'active' | 'expiring' | 'expired' | 'none' {
  if (!m) return 'none'
  const d = daysLeft(m.end_date, today)
  if (d < 0) return 'expired'
  if (d <= 11) return 'expiring'
  return 'active'
}

// ---- Small date helpers ----

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Whole calendar days from a to b ('YYYY-MM-DD' or a timestamp; only the date part counts)
export function daysBetween(aIso: string, bIso: string): number {
  const a = parseDate(aIso.slice(0, 10))
  const b = parseDate(bIso.slice(0, 10))
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

// "18:30" / "18:30:00" → minutes after midnight; null when there is no readable time
function minutesOf(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '')
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h > 23 || min > 59 ? null : h * 60 + min
}

// ---- 1. Today: one batch's state ----

export const NO_END_MINUTES = 60   // a batch without an end time counts as one hour long

export type BatchState =
  | { kind: 'done'; came: number }
  | { kind: 'missed'; endedLabel: string }
  | { kind: 'on' }
  | { kind: 'upcoming'; startsLabel: string }
  | { kind: 'no-time' }

// rows: attendance rows (any batch / day; filtered here to this batch, today, present)
export function batchState(
  batch: Pick<Batch, 'id' | 'start_time' | 'end_time'>,
  rows: AttendanceRow[],
  nowLocal: Date,
  country: Country | null,
): BatchState {
  const today = iso(nowLocal)
  const came = new Set(rows.filter(r => r.batch_id === batch.id && r.class_date === today && r.present).map(r => r.profile_id)).size
  if (came > 0) return { kind: 'done', came }
  const start = minutesOf(batch.start_time)
  if (start === null) return { kind: 'no-time' }
  const endGiven = minutesOf(batch.end_time)
  const end = endGiven !== null && endGiven > start ? endGiven : start + NO_END_MINUTES
  const now = nowLocal.getHours() * 60 + nowLocal.getMinutes()
  if (now < start) return { kind: 'upcoming', startsLabel: timeLabel(batch.start_time, country) }
  if (now >= end) {
    const endedLabel = endGiven !== null && endGiven > start
      ? timeLabel(batch.end_time, country)
      : timeLabel(`${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`, country)
    return { kind: 'missed', endedLabel }
  }
  return { kind: 'on' }
}

// ---- 2. Today summary ----

export function todaySummary(states: BatchState[]): { done: number; total: number; came: number; missed: number } {
  return {
    done: states.filter(s => s.kind === 'done').length,
    total: states.length,
    came: states.reduce((n, s) => n + (s.kind === 'done' ? s.came : 0), 0),
    missed: states.filter(s => s.kind === 'missed').length,
  }
}

// "2 of 4 batches done · 27 came · 1 missed" (no "· 0 missed")
export function todaySummaryText(s: { done: number; total: number; came: number; missed: number }): string {
  if (!s.total) return ''
  const parts = [`${s.done} of ${s.total} batch${s.total === 1 ? '' : 'es'} done`, `${s.came} came`]
  if (s.missed) parts.push(`${s.missed} missed`)
  return parts.join(' · ')
}

// ---- 3. Who took the roll call ----

export type StaffName = { full_name: string | null; role: string | null }

// The person who marked most of this batch's rows today. A sensei (coach login) reads "Sensei Ravi"
// (staffOne = staffWord().one), the owner / a partner by first name ("Anand"), as everywhere else. Unknown → ''.
export function markedByName(
  rows: Pick<AttendanceRow, 'marked_by' | 'present'>[],
  staffById: Record<string, StaffName>,
  staffOne = 'Sensei',
): string {
  const counts = new Map<string, number>()
  for (const r of rows) if (r.present && r.marked_by) counts.set(r.marked_by, (counts.get(r.marked_by) || 0) + 1)
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const who = top ? staffById[top] : undefined
  if (!who) return ''
  const first = (who.full_name || '').trim().replace(/^(coach|sensei)\s+/i, '').split(/\s+/)[0] || ''
  if (who.role === 'coach') return first ? `${staffOne} ${first}` : staffOne
  return first
}

// ---- 4. Fees to collect ----

export const LAPSED_DAYS = 60   // lapsed in the last 60 days (decision 14 Nov); older ones stay in the Expired tab only

export type FeeStudent = {
  id: string
  full_name: string
  phone?: string | null
  archived_at?: string | null
  branch_id?: string | null
  guardian_name?: string | null
  guardian_phone?: string | null
  guardian_relation?: string | null
  memberships: MembershipLike[]
}

export type FeeRow<S extends FeeStudent = FeeStudent> = {
  key: string                    // the parent's phone digits, else the student id
  name: string                   // the parent's name, else the student's
  line: string                   // parentLine: "Mother of Aarav", "Father of Anaya & Arjun" or ''
  students: S[]                  // one, or siblings on one parent phone (earliest due first)
  amount: number                 // last amount paid, siblings added (one currency: siblings pay in the same one)
  currency: string | null
  dueDate: string                // the earliest end date in the row
  daysLeft: number               // daysLeft of dueDate (negative = lapsed)
  phone: string | null           // the parent's phone, else the student's (for Call)
}

// The parent phone as country code + number (+919876543210 and an old 9876543210 are the same parent):
// siblings with the same parent phone are one family. '' = no parent phone
function parentKey(s: FeeStudent, country: Country | null): string {
  const parts = splitE164(s.guardian_phone, country)
  return parts ? PHONE_COUNTRIES[parts.country].dial + parts.local : (s.guardian_phone || '').replace(/\D/g, '')
}

// "Mother of Aarav" when the guardian is set, else ''. Several students: "Father of Anaya & Arjun", "Mother of A, B & C"
export function parentLine(students: FeeStudent | FeeStudent[]): string {
  const list = Array.isArray(students) ? students : [students]
  const first = list[0]
  if (!first || !(first.guardian_name || '').trim()) return ''
  const relation = (first.guardian_relation || '').trim() || 'Parent'
  const names = list.map(s => (s.full_name || '').trim().split(/\s+/)[0]).filter(Boolean)
  const joined = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
  return `${relation} of ${joined}`
}

// One row per family in a list (siblings on one parent phone collapse; students without a parent phone stay alone)
function familyRows<S extends FeeStudent>(items: { s: S; m: MembershipLike; d: number }[], country: Country | null): FeeRow<S>[] {
  const groups = new Map<string, { s: S; m: MembershipLike; d: number }[]>()
  for (const it of items) {
    const k = parentKey(it.s, country) || `student:${it.s.id}`
    groups.set(k, [...(groups.get(k) || []), it])
  }
  return [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.d - b.d)
    const students = sorted.map(x => x.s)
    const lead = sorted[0]
    const hasParent = !!(lead.s.guardian_name || '').trim()
    return {
      key,
      name: hasParent ? (lead.s.guardian_name || '').trim() : lead.s.full_name,
      line: parentLine(students),
      students,
      amount: sorted.reduce((n, x) => n + (Number(x.m.amount_paid) || 0), 0),
      currency: lead.m.currency ?? null,
      dueDate: lead.m.end_date,
      daysLeft: lead.d,
      phone: (lead.s.guardian_phone || '').trim() || (lead.s.phone || '').trim() || null,
    }
  })
}

export function feesToCollect<S extends FeeStudent>(opts: {
  students: S[]
  today?: Date
  baseCurrency: string | null
  country: Country | null
  lapsedDays?: number
}): {
  dueThisWeek: FeeRow<S>[]
  lapsed: FeeRow<S>[]
  totals: { byCurrency: { currency: Currency; amount: number }[]; parents: number }
} {
  const today = opts.today ?? new Date()
  const lapsedDays = opts.lapsedDays ?? LAPSED_DAYS
  const due: { s: S; m: MembershipLike; d: number }[] = []
  const lapsed: { s: S; m: MembershipLike; d: number }[] = []
  for (const s of opts.students) {
    if (s.archived_at) continue
    const m = latestMembership(s.memberships || [])
    if (!m) continue
    const d = daysLeft(m.end_date, today)
    // Due this week: the same rule as the Remind / Send reminder button (lib/guardian.ts FEE_REMINDER_DAYS)
    if (d >= 0 && d <= FEE_REMINDER_DAYS) due.push({ s, m, d })
    else if (d < 0 && d >= -lapsedDays) lapsed.push({ s, m, d })
  }
  const dueThisWeek = familyRows(due, opts.country).sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name))
  // Most recently lapsed first (closest to 0)
  const lapsedRows = familyRows(lapsed, opts.country).sort((a, b) => b.daysLeft - a.daysLeft || a.name.localeCompare(b.name))
  const all = [...due, ...lapsed]
  const byCurrency = groupByCurrency(all, x => Number(x.m.amount_paid) || 0, x => x.m.currency, opts.baseCurrency)
  // Parents: by parent phone when set, else by student (siblings count once)
  const parents = new Set(all.map(x => parentKey(x.s, opts.country) || `student:${x.s.id}`)).size
  return { dueThisWeek, lapsed: lapsedRows, totals: { byCurrency, parents } }
}

// tel: link in E.164 (+919876543210) for a stored phone; null when it isn't a readable number
export function telHref(phone: string | null | undefined, country: Country | null): string | null {
  const parts = splitE164(phone, country)
  if (!parts) return null
  return `tel:+${PHONE_COUNTRIES[parts.country].dial}${parts.local}`
}

// ---- 5. Not seen ----

export const NOT_SEEN_DAYS = 14
export const ATTENDANCE_LOOKBACK_DAYS = 60   // the one attendance read on load goes back this far

export type NotSeenRow<S> = { student: S; lastPresent: string | null; daysAway: number }

// Active students (not expired, not archived) with no present attendance in the last `days` days, who joined at least
// `days` days ago. Absence counts from the last class, else from the later of the join date and the gym's first
// attendance day (attendanceSince; decision 14 Nov), so a gym that only just started roll calls doesn't flag everyone.
// No attendance in the gym yet (attendanceSince null) → nobody. Longest away first.
export function notSeen<S extends { id: string; created_at: string; archived_at?: string | null; memberships: MembershipLike[] }>(opts: {
  students: S[]
  lastPresentByStudent: Record<string, string>
  attendanceSince: string | null
  today: string               // 'YYYY-MM-DD'
  days?: number
}): NotSeenRow<S>[] {
  const days = opts.days ?? NOT_SEEN_DAYS
  if (!opts.attendanceSince) return []
  const now = parseDate(opts.today)
  const out: NotSeenRow<S>[] = []
  for (const s of opts.students) {
    if (s.archived_at) continue
    if (membershipStatus(latestMembership(s.memberships || []), now) === 'expired') continue
    const joined = (s.created_at || '').slice(0, 10)
    if (!joined || daysBetween(joined, opts.today) < days) continue
    const last = opts.lastPresentByStudent[s.id] || null
    const from = last ?? (joined > opts.attendanceSince ? joined : opts.attendanceSince)
    const away = daysBetween(from, opts.today)
    if (away >= days) out.push({ student: s, lastPresent: last, daysAway: away })
  }
  return out.sort((a, b) => b.daysAway - a.daysAway)
}

// The last present date per student, and the gym's first attendance day, from the rows of the one read on load
export function lastPresentDates(rows: { profile_id: string; class_date: string }[]): { last: Record<string, string>; since: string | null } {
  const last: Record<string, string> = {}
  let since: string | null = null
  for (const r of rows) {
    if (!last[r.profile_id] || r.class_date > last[r.profile_id]) last[r.profile_id] = r.class_date
    if (!since || r.class_date < since) since = r.class_date
  }
  return { last, since }
}

// "Aarav, Diya, Kabir and 4 more"
export function firstNamesLine(names: string[], show = 3): string {
  const first = names.map(n => (n || '').trim().split(/\s+/)[0]).filter(Boolean)
  if (first.length <= show) return first.join(', ')
  return `${first.slice(0, show).join(', ')} and ${first.length - show} more`
}

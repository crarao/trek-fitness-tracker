// Belt grading, Phase 1 (supabase/migrations/20261110120000_belt_grading.sql): the student's current belt.
// profiles.current_rank_id + rank_achieved_on hold the CURRENT belt; student_grades is the history log
// (one row each time current_rank_id changes: 'joined' on Add, 'backfill' when first set later, 'manual' on a change).
// Shown only when companies.grading_enabled is true (super admin; on for DSSKA). Check: scripts/check-belts.ts

import { type Country, formatDate, greet } from './locale'
import { formatMoney } from './currency'
import { pickRecipient, type GuardianFields } from './guardian'
import { waDigits } from './phone'
import { timeLabel } from './batches'

export type BeltRank = {
  id: string
  rank_order: number
  belt_name: string
  kyu: number | null
  color_hex: string
  is_active: boolean
  // Months needed on the previous belt before grading for this one (null / 0 = no wait)
  min_months_from_previous?: number | null
  // Black belts: 1st dan, 2nd dan… (Phase 2 SQL; never set together with kyu). Undefined before that SQL ran
  dan?: number | null
}

// '*' so dan (Phase 2 SQL) is read once it exists and nothing breaks before
export const BELT_RANK_COLUMNS = '*'

// companies.grading_enabled: undefined before the SQL ran, so it counts as off
export function gradingOn(company: { grading_enabled?: boolean | null } | null | undefined): boolean {
  return company?.grading_enabled === true
}

export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  const last = n % 10
  return `${n}${last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th'}`
}

// "White", "Yellow – 8th kyu", "Brown – 2nd kyu"
export function beltLabel(rank: Pick<BeltRank, 'belt_name' | 'kyu' | 'dan'> | null | undefined): string {
  if (!rank) return 'Belt not set'
  if (rank.kyu) return `${rank.belt_name} – ${ordinal(rank.kyu)} kyu`
  if (rank.dan) return `${rank.belt_name} – ${ordinal(rank.dan)} dan`
  return rank.belt_name
}

// Ladder order (rank_order); inactive belts only when it's the student's saved one
export function beltOptions(ranks: BeltRank[], keepId?: string | null): BeltRank[] {
  return ranks.filter(r => r.is_active || r.id === keepId).sort((a, b) => a.rank_order - b.rank_order)
}

// New student's default: the first active belt (White)
export function defaultBeltId(ranks: BeltRank[]): string {
  return beltOptions(ranks)[0]?.id ?? ''
}

// History source when the belt changes on an existing student
export function gradeSource(previousRankId: string | null | undefined): 'backfill' | 'manual' {
  return previousRankId ? 'manual' : 'backfill'
}

// YYYY-MM-DD that is a real date
export function validIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// ── Phase 2, PR A: belt chips + belt history ────────────────────────────────────────────────────────

// Gym belts by id, for lists (load belt_ranks once per page, never per student)
export function beltsById(ranks: BeltRank[]): Record<string, BeltRank> {
  return Object.fromEntries(ranks.map(r => [r.id, r]))
}

// Chip text: "White", "8 kyu" (a belt without a kyu shows its name)
export function beltChipText(rank: Pick<BeltRank, 'belt_name' | 'kyu' | 'dan'>): string {
  if (rank.kyu) return `${rank.kyu} kyu`
  if (rank.dan) return `${rank.dan} dan`
  return rank.belt_name
}

// Light belts (White, Yellow) get a grey ring so they show on the dark screens; '#RGB' / '#RRGGBB'
export function isLightBelt(hex: string | null | undefined): boolean {
  const h = (hex || '').trim().replace(/^#/, '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  if (!/^[0-9a-f]{6}$/i.test(full)) return true
  const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) > 186
}

export type GradeSource = 'joined' | 'backfill' | 'manual' | 'exam'

export type StudentGrade = {
  id: string
  rank_id: string
  achieved_on: string | null
  source: GradeSource | string
  exam_id: string | null
  created_by: string | null
  created_at: string
  voided_at?: string | null  // Undo results (Phase 2 SQL): hidden from the history
}

export const STUDENT_GRADE_COLUMNS = 'id, rank_id, achieved_on, source, exam_id, created_by, created_at'

// The rows to show: undone exam rows (voided_at set) are hidden; newest first
export function visibleGradeHistory<T extends Pick<StudentGrade, 'achieved_on' | 'created_at' | 'voided_at'>>(rows: T[]): T[] {
  return sortGradeHistory(rows.filter(r => !r.voided_at))
}

// History line source label
export function gradeSourceLabel(source: string | null | undefined): string {
  switch (source) {
    case 'joined': return 'Joined'
    case 'backfill': return 'Entered later'
    case 'manual': return 'Changed'
    case 'exam': return 'Exam'
    default: return ''
  }
}

// Newest change first: by when the row was saved (12 Nov: sorting by the "since" date put an older belt on top
// after a correction back to an earlier date; the top row must always be the current belt)
export function sortGradeHistory<T extends Pick<StudentGrade, 'achieved_on' | 'created_at'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// ── Phase 2, PR B: grading exams + who can sit them ─────────────────────────────────────────────────

export type GradingExam = {
  id: string
  company_id: string
  exam_date: string
  exam_time: string | null
  venue: string | null
  fee_amount: number | null
  notes: string | null
  status: 'scheduled' | 'completed' | 'cancelled' | string
  created_at: string
  // Fee per belt graded TO (rank id → amount), set when the exam is scheduled; missing belt = fee_amount.
  // Column from 20261112120000_belt_grading_fee_brown1.sql: undefined before it ran
  belt_fees?: Record<string, number> | null
}
// '*' so belt_fees is read once its SQL ran, and nothing breaks before
export const GRADING_EXAM_COLUMNS = '*'

export type ExamCandidate = {
  id: string
  exam_id: string
  student_id: string
  from_rank_id: string | null
  to_rank_id: string
  fee_paid: boolean | null
  result: 'pass' | 'fail' | null | string
  notice_sent_at: string | null
  result_sent_at: string | null
  removed_at?: string | null
  cancel_sent_at?: string | null
  created_at?: string
}
// removed_at / cancel_sent_at: supabase/migrations/20261111120000_belt_grading_phase2.sql
export const EXAM_CANDIDATE_COLUMNS = 'id, exam_id, student_id, from_rank_id, to_rank_id, fee_paid, result, notice_sent_at, result_sent_at, removed_at, cancel_sent_at'

// A month on a belt = 30 days (decision 11 Nov: "3 months" = 90 days)
export const DAYS_PER_MONTH = 30

// The next belt up the ladder: the next ACTIVE belt by rank_order (never skips one; decision D5). null = top belt
export function nextBelt(ranks: BeltRank[], currentId: string | null | undefined): BeltRank | null {
  const current = ranks.find(r => r.id === currentId)
  if (!current) return null
  return ranks.filter(r => r.is_active && r.rank_order > current.rank_order)
    .sort((a, b) => a.rank_order - b.rank_order)[0] ?? null
}

// Whole days from one 'YYYY-MM-DD' to another (later minus earlier; negative when "to" is earlier)
export function daysBetween(fromIso: string, toIso: string): number {
  const [a, b] = [fromIso, toIso].map(d => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, dd) })
  return Math.round((b - a) / 86_400_000)
}

export type Eligibility =
  | { kind: 'no-belt' }                                                    // set the belt on their profile first
  | { kind: 'top'; from: BeltRank }                                        // highest belt
  | { kind: 'not-yet'; from: BeltRank; to: BeltRank; daysToGo: number }   // the gap isn't over by the exam date
  | { kind: 'eligible'; from: BeltRank; to: BeltRank; dateMissing: boolean }

// Can this student sit the exam? The wait is counted to the EXAM date (decision 11 Nov) and can't be overridden.
// Belt date unknown: eligible, with a "belt date missing" warning (decision D3).
export function eligibility(opts: {
  ranks: BeltRank[]
  currentRankId: string | null | undefined
  achievedOn: string | null | undefined
  examDate: string
}): Eligibility {
  const from = opts.ranks.find(r => r.id === opts.currentRankId)
  if (!from) return { kind: 'no-belt' }
  const to = nextBelt(opts.ranks, from.id)
  if (!to) return { kind: 'top', from }
  if (!opts.achievedOn) return { kind: 'eligible', from, to, dateMissing: true }
  const need = Math.max(0, to.min_months_from_previous || 0) * DAYS_PER_MONTH
  const have = daysBetween(opts.achievedOn, opts.examDate)
  return have >= need ? { kind: 'eligible', from, to, dateMissing: false } : { kind: 'not-yet', from, to, daysToGo: need - have }
}

// "2 mo to go" (30-day months, rounded up), "12 days to go", "1 day to go"
export function toGoText(days: number): string {
  if (days >= DAYS_PER_MONTH) return `${Math.ceil(days / DAYS_PER_MONTH)} mo to go`
  return `${days} day${days === 1 ? '' : 's'} to go`
}

// Why a student can't be ticked (null = they can)
export function notEligibleText(e: Eligibility): string | null {
  if (e.kind === 'no-belt') return 'Set the belt on their profile first'
  if (e.kind === 'top') return 'Highest belt'
  if (e.kind === 'not-yet') return toGoText(e.daysToGo)
  return null
}

// Upcoming (scheduled, today or later) first by date; then past / completed / cancelled, newest first
export function splitExams<T extends Pick<GradingExam, 'exam_date' | 'status'>>(exams: T[], today: string): { upcoming: T[]; past: T[] } {
  const upcoming = exams.filter(e => e.status === 'scheduled' && e.exam_date >= today).sort((a, b) => a.exam_date.localeCompare(b.exam_date))
  const past = exams.filter(e => !(e.status === 'scheduled' && e.exam_date >= today)).sort((a, b) => b.exam_date.localeCompare(a.exam_date))
  return { upcoming, past }
}

// Status label for an exam card ("Results due" = scheduled and the date has passed)
export function examStatusLabel(e: Pick<GradingExam, 'exam_date' | 'status'>, today: string): string {
  if (e.status === 'completed') return 'Completed'
  if (e.status === 'cancelled') return 'Cancelled'
  return e.exam_date < today ? 'Results due' : 'Scheduled'
}

// Changing the date, time or venue clears "Sent ✓" on the notices (decision 10): the parents need the new details
export function examDetailsChanged(a: Pick<GradingExam, 'exam_date' | 'exam_time' | 'venue'>, b: Pick<GradingExam, 'exam_date' | 'exam_time' | 'venue'>): boolean {
  const t = (x: string | null) => (x || '').slice(0, 5)
  return a.exam_date !== b.exam_date || t(a.exam_time) !== t(b.exam_time) || (a.venue || '').trim() !== (b.venue || '').trim()
}

// Attendance shown next to a candidate (information only; no rule yet, decision 11 Nov):
// classes attended (any batch, one per day) vs their home batch's classes, from the latest of the belt date,
// the day they joined and the gym's first attendance day, up to the exam date or today, whichever is earlier.
export function attendanceShare(opts: {
  attended: string[]                 // the student's present days ('YYYY-MM-DD'), any order, duplicates ok
  homeDays: readonly string[] | null // home batch weekdays ('Mon'…'Sun'); null = no home batch
  from: (string | null | undefined)[] // candidates for the start; the latest one wins
  until: string                      // min(exam date, today)
}): { attended: number; scheduled: number | null; pct: number | null } {
  const start = opts.from.filter((d): d is string => !!d).map(d => d.slice(0, 10)).sort().pop() || opts.until
  const days = new Set(opts.attended.filter(d => d >= start && d <= opts.until))
  if (!opts.homeDays || !opts.homeDays.length) return { attended: days.size, scheduled: null, pct: null }
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const want = new Set(opts.homeDays)
  let scheduled = 0
  for (let n = 0; n <= daysBetween(start, opts.until); n++) {
    const [y, m, d] = start.split('-').map(Number)
    if (want.has(names[new Date(Date.UTC(y, m - 1, d + n)).getUTCDay()])) scheduled++
  }
  if (!scheduled) return { attended: days.size, scheduled: 0, pct: null }
  return { attended: days.size, scheduled, pct: Math.min(100, Math.round((days.size / scheduled) * 100)) }
}

// ── Fees per belt (12 Nov: fixed when the exam is scheduled; same fee up to a belt, more above) ─────

// What grading TO this belt costs on this exam: its own fee, else the exam fee (null = no fee)
export function beltFee(exam: Pick<GradingExam, 'fee_amount' | 'belt_fees'>, toRankId: string): number | null {
  const own = exam.belt_fees?.[toRankId]
  if (own != null && Number.isFinite(Number(own))) return Number(own)
  return exam.fee_amount != null ? Number(exam.fee_amount) : null
}

// "₹500 · Brown – 3rd kyu, Brown – 2nd kyu ₹800": the exam fee, then belts that differ grouped by amount
export function feeSummary(
  exam: Pick<GradingExam, 'fee_amount' | 'belt_fees'>,
  ranks: BeltRank[],
  money: (n: number) => string,
): string {
  const base = exam.fee_amount != null ? money(Number(exam.fee_amount)) : 'No fee'
  const groups = new Map<number, string[]>()
  for (const r of [...ranks].sort((a, b) => a.rank_order - b.rank_order)) {
    const v = exam.belt_fees?.[r.id]
    if (v == null || Number(v) === Number(exam.fee_amount)) continue
    groups.set(Number(v), [...(groups.get(Number(v)) || []), beltLabel(r)])
  }
  return [base, ...[...groups].map(([v, names]) => `${names.join(', ')} ${money(v)}`)].join(' · ')
}

// ── PR C: parent messages (notice, result, cancelled). Pure: the page opens wa.me with the text ─────

export type GradingParty = GuardianFields  // the student: full_name, phone, guardian_name / _phone

// Who it goes to (pickRecipient: the parent when their phone is a WhatsApp number, else the student) + greeting name
export function gradingRecipient(student: GradingParty, country: Country | null): { waDigits: string | null; greetName: string; toParent: boolean } {
  const to = pickRecipient(student, raw => waDigits(raw, country))
  const first = (n: string | null | undefined) => (n || '').trim().split(/\s+/)[0] || ''
  return { waDigits: to.phone, greetName: to.toParent ? first(student.guardian_name) : first(student.full_name), toParent: to.toParent }
}

const firstOf = (n: string | null | undefined) => (n || '').trim().split(/\s+/)[0] || ''

// Exam notice (decision: no he / she / they; the name is repeated). UPI lines only with a fee and the gym's UPI ID.
export function gradingNoticeText(opts: {
  student: GradingParty
  exam: Pick<GradingExam, 'exam_date' | 'exam_time' | 'venue' | 'notes' | 'fee_amount' | 'belt_fees'>
  from: Pick<BeltRank, 'belt_name' | 'kyu'> | null | undefined
  to: Pick<BeltRank, 'id' | 'belt_name' | 'kyu'>
  gymName: string
  currency: string | null
  country: Country | null
  upiId?: string | null
}): string {
  const { exam, country } = opts
  const r = gradingRecipient(opts.student, country)
  const kid = firstOf(opts.student.full_name)
  const when = [formatDate(exam.exam_date, country, 'weekday'), exam.exam_time ? timeLabel(exam.exam_time, country) : ''].filter(Boolean).join(', ')
  const fee = beltFee(exam, opts.to.id)
  const upi = (opts.upiId || '').trim()
  const lines = [
    greet(r.greetName, `${r.toParent ? `${kid}'s` : 'your'} belt grading is on *${when}*${exam.venue ? ` at ${exam.venue}` : ''}.`, country),
    `Grading: ${beltLabel(opts.from)} → *${beltLabel(opts.to)}*`,
    ...(fee != null && fee > 0 ? [`Exam fee: *${formatMoney(fee, opts.currency || 'INR')}*`] : []),
    ...(fee != null && fee > 0 && upi ? [`Pay via UPI: *${upi}* (please add "${(opts.student.full_name || "").trim()}" in the payment note)`] : []),
    ...((exam.notes || '').trim() ? ['', (exam.notes || '').trim()] : []),
    '',
    `— ${opts.gymName.trim()} 🥋`,
  ]
  return lines.join('\n')
}

// Result: pass → the new belt; fail → kind, no pronouns (wording agreed 12 Nov)
export function gradingResultText(opts: {
  student: GradingParty
  result: 'pass' | 'fail'
  examDate: string
  from: Pick<BeltRank, 'belt_name' | 'kyu'> | null | undefined
  to: Pick<BeltRank, 'belt_name' | 'kyu'>
  gymName: string
  country: Country | null
}): string {
  const r = gradingRecipient(opts.student, opts.country)
  const kid = firstOf(opts.student.full_name)
  const date = formatDate(opts.examDate, opts.country, 'dayMonth')
  const body = opts.result === 'pass'
    ? `${r.toParent ? kid : 'you'} passed the grading on ${date} and ${r.toParent ? 'is' : 'are'} now *${beltLabel(opts.to)}*. Well done! 🎉`
    : r.toParent
      ? `${kid} worked hard at the grading on ${date}. ${kid} stays ${beltLabel(opts.from)} for now and can try again at the next grading. Keep practising!`
      : `you worked hard at the grading on ${date}. You stay ${beltLabel(opts.from)} for now and can try again at the next grading. Keep practising!`
  return `${greet(r.greetName, body, opts.country)}\n— ${opts.gymName.trim()} 🥋`
}

// The exam was cancelled (sent to those who had the notice)
export function gradingCancelText(opts: { student: GradingParty; examDate: string; gymName: string; country: Country | null }): string {
  const r = gradingRecipient(opts.student, opts.country)
  const kid = firstOf(opts.student.full_name)
  const body = `${r.toParent ? `${kid}'s` : 'your'} belt grading on ${formatDate(opts.examDate, opts.country, 'dayMonth')} is cancelled. We will share the new date soon.`
  return `${greet(r.greetName, body, opts.country)}\n— ${opts.gymName.trim()} 🥋`
}

export const waLink = (digits: string, text: string) => `https://wa.me/${digits}?text=${encodeURIComponent(text)}`

// Save results is allowed when every student on the list has Pass or Fail
export function resultsReady(cands: Pick<ExamCandidate, 'result' | 'removed_at'>[]): boolean {
  const on = cands.filter(c => !c.removed_at)
  return on.length > 0 && on.every(c => c.result === 'pass' || c.result === 'fail')
}

// Save / Undo replies (rpc jsonb) → a sentence for the owner
export function gradingRpcMessage(res: { ok?: boolean; error?: string; names?: string[]; promoted?: number; failed?: number; skipped?: number; undone?: number; already?: boolean } | null): string {
  if (!res) return 'No reply from the server. Try again.'
  if (res.ok) {
    if (res.already) return 'Results were already saved.'
    if (res.undone != null) return `Undone: ${res.undone} belt${res.undone === 1 ? '' : 's'} put back.`
    return `Saved ✓ ${res.promoted ?? 0} promoted${res.failed ? `, ${res.failed} stay` : ''}${res.skipped ? `, ${res.skipped} already done` : ''}.`
  }
  const names = (res.names || []).join(', ')
  switch (res.error) {
    case 'missing_results': return `Mark Pass or Fail for: ${names}`
    case 'belt_changed': return `Nothing saved. These belts changed since they were picked: ${names}. Untick and tick them again.`
    case 'belt_changed_since': return `Can't undo: these belts changed after the exam: ${names}.`
    case 'not_allowed': return 'Only the owner or a partner can do this.'
    case 'cancelled': return 'This exam is cancelled.'
    case 'not_completed': return 'Results are not saved yet.'
    case 'no_candidates': return 'Nobody is on this exam.'
    default: return `Couldn't save (${res.error || 'unknown'}).`
  }
}

// ── PR D: belts set up by super admin (Super Admin → Companies → Edit) ─────────────────────────────

// The standard ladder ("Add standard belts"): DSSKA's, with Brown 1st kyu (12 Nov). rank_order 0…8
export const STANDARD_BELTS: { belt_name: string; kyu: number | null; color_hex: string; min_months_from_previous: number | null }[] = [
  { belt_name: 'White', kyu: null, color_hex: '#FFFFFF', min_months_from_previous: null },
  { belt_name: 'Yellow', kyu: 8, color_hex: '#FACC15', min_months_from_previous: 3 },
  { belt_name: 'Orange', kyu: 7, color_hex: '#F97316', min_months_from_previous: 3 },
  { belt_name: 'Green', kyu: 6, color_hex: '#16A34A', min_months_from_previous: 3 },
  { belt_name: 'Blue', kyu: 5, color_hex: '#2563EB', min_months_from_previous: 3 },
  { belt_name: 'Purple', kyu: 4, color_hex: '#7C3AED', min_months_from_previous: 3 },
  { belt_name: 'Brown', kyu: 3, color_hex: '#78350F', min_months_from_previous: 3 },
  { belt_name: 'Brown', kyu: 2, color_hex: '#78350F', min_months_from_previous: 6 },
  { belt_name: 'Brown', kyu: 1, color_hex: '#78350F', min_months_from_previous: 6 },
]

export type BeltDraft = { id: string | null; belt_name: string; grade: 'none' | 'kyu' | 'dan'; number: string; color_hex: string; months: string }

// A belt form → row fields, or a problem to show. withDan: only once belt_ranks.dan exists
export function beltFields(d: BeltDraft, withDan: boolean): { belt_name: string; kyu: number | null; dan?: number | null; color_hex: string; min_months_from_previous: number | null } | string {
  const name = d.belt_name.replace(/\s+/g, ' ').trim()
  if (!name) return 'Add the belt name (e.g. Black)'
  if (name.length > 40) return 'Keep the name under 40 characters'
  if (!/^#[0-9A-Fa-f]{6}$/.test(d.color_hex)) return 'Pick the belt colour'
  const n = d.number.trim() === '' ? null : Number(d.number)
  if (d.grade !== 'none' && (n === null || !Number.isInteger(n))) return `Add the ${d.grade} number`
  if (d.grade === 'kyu' && (n! < 1 || n! > 20)) return 'Kyu is 1 to 20'
  if (d.grade === 'dan' && (n! < 1 || n! > 10)) return 'Dan is 1 to 10'
  if (d.grade === 'dan' && !withDan) return 'Dan belts need the Phase 2 SQL first'
  const m = d.months.trim() === '' ? null : Number(d.months)
  if (m !== null && (!Number.isInteger(m) || m < 0 || m > 120)) return 'Months: a whole number (or empty)'
  return {
    belt_name: name, kyu: d.grade === 'kyu' ? n : null, ...(withDan ? { dan: d.grade === 'dan' ? n : null } : {}),
    color_hex: d.color_hex.toUpperCase(), min_months_from_previous: m,
  }
}

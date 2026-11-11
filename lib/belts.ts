// Belt grading, Phase 1 (supabase/migrations/20261110120000_belt_grading.sql): the student's current belt.
// profiles.current_rank_id + rank_achieved_on hold the CURRENT belt; student_grades is the history log
// (one row each time current_rank_id changes: 'joined' on Add, 'backfill' when first set later, 'manual' on a change).
// Shown only when companies.grading_enabled is true (super admin; on for DSSKA). Check: scripts/check-belts.ts

export type BeltRank = {
  id: string
  rank_order: number
  belt_name: string
  kyu: number | null
  color_hex: string
  is_active: boolean
  // Months needed on the previous belt before grading for this one (null / 0 = no wait)
  min_months_from_previous?: number | null
}

export const BELT_RANK_COLUMNS = 'id, rank_order, belt_name, kyu, color_hex, is_active, min_months_from_previous'

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
export function beltLabel(rank: Pick<BeltRank, 'belt_name' | 'kyu'> | null | undefined): string {
  if (!rank) return 'Belt not set'
  return rank.kyu ? `${rank.belt_name} – ${ordinal(rank.kyu)} kyu` : rank.belt_name
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
export function beltChipText(rank: Pick<BeltRank, 'belt_name' | 'kyu'>): string {
  return rank.kyu ? `${rank.kyu} kyu` : rank.belt_name
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

// Newest first: by belt date (unknown dates by when the row was saved), then when it was saved
export function sortGradeHistory<T extends Pick<StudentGrade, 'achieved_on' | 'created_at'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    (b.achieved_on || b.created_at.slice(0, 10)).localeCompare(a.achieved_on || a.created_at.slice(0, 10))
    || b.created_at.localeCompare(a.created_at))
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
}
export const GRADING_EXAM_COLUMNS = 'id, company_id, exam_date, exam_time, venue, fee_amount, notes, status, created_at'

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
  fee_amount?: number | null   // this student's fee (20261112120000_belt_grading_fee_brown1.sql); null = the exam's fee
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

// ── Fee per student (12 Nov: each belt grade can cost differently) ──────────────────────────────────

// The fee to fill in when a student is ticked: the last fee typed for the same next belt on this exam,
// else the exam's fee (null = none)
export function suggestedFee(
  candidates: Pick<ExamCandidate, 'to_rank_id' | 'fee_amount' | 'removed_at' | 'created_at'>[],
  toRankId: string,
  examFee: number | null | undefined,
): number | null {
  const same = candidates.filter(c => c.to_rank_id === toRankId && !c.removed_at && c.fee_amount != null)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  if (same.length) return Number(same[0].fee_amount)
  return examFee != null ? Number(examFee) : null
}

// What this student pays: their own fee, else the exam's
export function candidateFee(c: Pick<ExamCandidate, 'fee_amount'>, examFee: number | null | undefined): number | null {
  if (c.fee_amount != null) return Number(c.fee_amount)
  return examFee != null ? Number(examFee) : null
}

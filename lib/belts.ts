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
}

export const BELT_RANK_COLUMNS = 'id, rank_order, belt_name, kyu, color_hex, is_active'

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
}

export const STUDENT_GRADE_COLUMNS = 'id, rank_id, achieved_on, source, exam_id, created_by, created_at'

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

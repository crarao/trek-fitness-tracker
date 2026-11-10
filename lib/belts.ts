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

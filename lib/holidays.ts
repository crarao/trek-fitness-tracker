// Dojo holidays (db/2026-11-19-dojo-activities-absences.md: holidays). A holiday closes the whole day for one branch,
// or for every branch when branch_id is empty: no roll call, nobody counted absent, the dojo home shows "Holiday"
// instead of "Not taken". Owner / partners keep the calendar on /company/holidays; remove = removed_at (never deleted).
// Pure helpers, no Supabase calls, so scripts/check-holidays.ts can run them. Dates are 'YYYY-MM-DD' strings.

import { parseDate } from './locale'

export type Holiday = {
  id: string
  company_id?: string
  branch_id: string | null      // null = all branches
  holiday_date: string
  name: string
  created_by?: string | null
  created_at?: string
  removed_at: string | null
  removed_by?: string | null
}
export const HOLIDAY_COLUMNS = 'id, company_id, branch_id, holiday_date, name, created_by, created_at, removed_at, removed_by'
export const HOLIDAY_NAME_MAX = 60

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const activeHolidays = (list: Holiday[]) => list.filter(h => !h.removed_at)

// The holiday that closes this branch on this date: the branch's own first, else an all-branches one. A student or
// batch with no branch is closed only by all-branches holidays.
export function holidayFor(list: Holiday[], branchId: string | null | undefined, date: string): Holiday | null {
  const day = activeHolidays(list).filter(h => h.holiday_date === date)
  return (branchId ? day.find(h => h.branch_id === branchId) : undefined) ?? day.find(h => !h.branch_id) ?? null
}

export const noClassesText = (h: Pick<Holiday, 'name'>) => `No classes — ${h.name}`

// What the calendar shows for a date in a scope ('all' = every holiday that day, any branch; a branch id = the
// holidays that close that branch: its own + all-branches)
export function holidaysShown(list: Holiday[], scope: string, date: string): Holiday[] {
  const day = activeHolidays(list).filter(h => h.holiday_date === date)
  const shown = scope === 'all' ? day : day.filter(h => !h.branch_id || h.branch_id === scope)
  return [...shown].sort((a, b) => (a.branch_id ? 1 : 0) - (b.branch_id ? 1 : 0) || a.name.localeCompare(b.name))
}

// Can this scope get a new holiday on this date? (one active per branch-or-all per day, the database's unique index)
export function canAdd(list: Holiday[], scope: string, date: string): boolean {
  const branchId = scope === 'all' ? null : scope
  return !activeHolidays(list).some(h => h.holiday_date === date && (h.branch_id ?? null) === branchId)
}

export const tidyHolidayName = (s: string) => s.replace(/\s+/g, ' ').trim()

export function holidayProblem(name: string): string {
  const n = tidyHolidayName(name)
  if (!n) return 'Give the holiday a name (e.g. Diwali).'
  if (n.length > HOLIDAY_NAME_MAX) return `Keep the name under ${HOLIDAY_NAME_MAX} characters.`
  return ''
}

// The month as weeks Monday → Sunday; days outside the month are null
export function monthGrid(anyDayIso: string): (string | null)[][] {
  const d = parseDate(anyDayIso)
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let i = 1; i <= days; i++) cells.push(iso(new Date(d.getFullYear(), d.getMonth(), i)))
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

// First day of the month n months from the month of anyDayIso
export function shiftMonth(anyDayIso: string, n: number): string {
  const d = parseDate(anyDayIso)
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 1))
}

export function monthBounds(anyDayIso: string): { from: string; to: string } {
  const d = parseDate(anyDayIso)
  return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }
}

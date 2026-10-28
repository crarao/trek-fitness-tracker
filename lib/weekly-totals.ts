// Sessions and minutes per week for the Progress charts (coach page, client screen, PDF report).
// Weeks run Monday–Sunday, like plans and "Calories since Mon". The last 8 weeks are shown,
// with empty weeks as 0, so a gap of several weeks is visible instead of hidden.

import { parseDate } from './locale'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Monday of the week a date falls in (YYYY-MM-DD)
export function mondayOf(date: string): string {
  const d = parseDate(date.slice(0, 10))
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return iso(d)
}

export type WeekTotal = { start: string; sessions: number; minutes: number }

// Oldest first; the last week is the one containing `lastDate`
export function weeklyTotals(
  sessions: { session_date: string; duration_minutes: number | null }[],
  lastDate: string,
  weeks = 8,
): WeekTotal[] {
  const last = parseDate(mondayOf(lastDate))
  return Array.from({ length: weeks }, (_, i) => {
    const s = new Date(last)
    s.setDate(last.getDate() - 7 * (weeks - 1 - i))
    const e = new Date(s)
    e.setDate(s.getDate() + 6)
    const start = iso(s), end = iso(e)
    const inWeek = sessions.filter(x => x.session_date >= start && x.session_date <= end)
    return { start, sessions: inWeek.length, minutes: inWeek.reduce((n, x) => n + (x.duration_minutes || 0), 0) }
  })
}

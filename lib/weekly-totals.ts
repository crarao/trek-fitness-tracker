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

// Sunday of the week starting `weekStart` (YYYY-MM-DD)
export function sundayOf(weekStart: string): string {
  const d = parseDate(weekStart.slice(0, 10))
  d.setDate(d.getDate() + 6)
  return iso(d)
}

// The one rule for "sessions in a week", used by the charts and the progress report
// (lib/progress-share.ts summarizeWeek): every logged session dated Monday–Sunday counts.
// session_date is compared as a plain YYYY-MM-DD string, so no UTC conversion can move it a day.
export function sessionsInWeek<T extends { session_date: string }>(sessions: T[], weekStart: string): T[] {
  const start = weekStart.slice(0, 10), end = sundayOf(start)
  return sessions.filter(x => {
    const d = x.session_date.slice(0, 10)
    return d >= start && d <= end
  })
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
    const start = iso(s)
    const inWeek = sessionsInWeek(sessions, start)
    return { start, sessions: inWeek.length, minutes: inWeek.reduce((n, x) => n + (x.duration_minutes || 0), 0) }
  })
}

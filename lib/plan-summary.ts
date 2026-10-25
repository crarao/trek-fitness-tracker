// Turns a weekly plan's free text into a short summary for compact plan cards.
// Works best with the AI format ("Day 1 – Upper Body Push (Beginner)" or
// "Monday – Legs", exercise lines starting with "-"). Hand-written plans
// without day headings fall back to their first two lines.

import { parseDate } from './locale'

const DAYS: Record<string, string> = {
  monday: 'Mon', mon: 'Mon',
  tuesday: 'Tue', tue: 'Tue', tues: 'Tue',
  wednesday: 'Wed', wed: 'Wed',
  thursday: 'Thu', thu: 'Thu', thurs: 'Thu',
  friday: 'Fri', fri: 'Fri',
  saturday: 'Sat', sat: 'Sat',
  sunday: 'Sun', sun: 'Sun',
}

const HEADING = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs)?|fri|sat|sun|day\s*\d+)\b\.?\s*(?:[–—:\-]\s*)?(.*)$/i

export type PlanSummary = {
  days: string[]        // e.g. ["Tue · Upper Body Push", "Wed · Rest"]
  workoutDays: number   // headings that aren't rest days
  exercises: number     // lines starting with -, • or *
  fallback: string[]    // first two lines when no day headings were found
}

export function summarizePlan(text: string): PlanSummary {
  const lines = (text || '').split('\n').map(l => l.trim()).filter(Boolean)
  const days: string[] = []
  let exercises = 0
  let workoutDays = 0

  for (const line of lines) {
    if (/^[-•*]/.test(line)) { exercises++; continue }
    if (/^(weekly training plan|note:)/i.test(line)) continue
    const m = line.match(HEADING)
    if (!m) continue
    const raw = m[1].toLowerCase().replace(/\s+/g, ' ')
    let label = DAYS[raw] ?? raw.replace(/^day\s*/, 'Day ')
    let rest = m[2]
    // "Day 1 – Tuesday – Upper Body" -> use the weekday as the label
    const inner = rest.match(/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s*(?:[–—:\-]\s*)?(.*)$/i)
    if (inner) { label = DAYS[inner[1].toLowerCase()]; rest = inner[2] }
    const isRest = /\brest\b/i.test(line)
    let focus = isRest ? 'Rest' : rest.replace(/\(.*?\)/g, '').replace(/[:\s]+$/, '').trim()
    if (focus.length > 28) focus = focus.slice(0, 27).trimEnd() + '…'
    days.push(focus ? `${label} · ${focus}` : label)
    if (!isRest) workoutDays++
  }

  return { days, workoutDays, exercises, fallback: days.length ? [] : lines.slice(0, 2) }
}

// Where a plan's week sits relative to today (week_start is a YYYY-MM-DD date)
export function weekStatus(weekStart: string): 'current' | 'upcoming' | 'past' {
  const start = parseDate(weekStart.slice(0, 10))
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (today < start) return 'upcoming'
  if (today > end) return 'past'
  return 'current'
}

// The part of a day label that identifies the day ("Tue · Upper Body Push" -> "Tue").
// Used to match logged sessions (logged_sessions.plan_day) to a plan's days, so a later
// edit of the day's focus text doesn't lose the ✓.
export function dayKey(label: string | null | undefined): string {
  return (label || '').split(' · ')[0].trim()
}

export const isRestDay = (label: string) => label.endsWith('· Rest') || label === 'Rest'

// Day keys of a plan that have a session logged against them
export function doneDayKeys(
  planId: string,
  sessions: { weekly_plan_id?: string | null; plan_day?: string | null }[]
): Set<string> {
  return new Set(
    sessions.filter(s => s.weekly_plan_id === planId && s.plan_day).map(s => dayKey(s.plan_day))
  )
}

// Today's date on this device as YYYY-MM-DD (not UTC, which is a day behind before 5:30 am in India)
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Last day of a plan's week: a plan covers 7 days from its start date (start + 6)
export function weekEnd(weekStart: string): Date {
  const end = parseDate(weekStart.slice(0, 10))
  end.setDate(end.getDate() + 6)
  return end
}

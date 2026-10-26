// Owner "Today's sessions" (ROADMAP #41): who trained today, which plan days are still due today,
// which workout days this week were missed, and sessions per coach.
// Rules:
//  - A plan covers 7 days from its start date; each weekday of the plan falls on one date in that week.
//  - A workout day is done when a session is logged against the plan with that day (plan_day), or a
//    session linked to the plan without a day falls on that date (client's Log form, text plans).
//  - Missed = a workout day whose date has passed (before today) and isn't done. Today is never missed.
//  - Only weekday-named days can be dated; text plans headed "Day 1, Day 2…" are left out.
//  - Coach = whoever logged the session (logged_sessions.logged_by). Any coach can train any client.

import { parseDate, localDateIso } from './locale'
import { dayKey, isRestDay } from './plan-summary'
import { WEEKDAYS, summarizeAny } from './plan-structure'

export type TodayPlan = { id: string; client_id?: string; week_start: string; plan_details: string; plan_json?: unknown }
export type TodaySession = {
  id: string
  client_id: string
  session_date: string
  duration_minutes: number | null
  weekly_plan_id?: string | null
  plan_day?: string | null
  exercises_done?: unknown
  activity?: string | null
  logged_by?: string | null
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Weekday ("Mon") -> its date (YYYY-MM-DD) within the plan's 7 days
export function planDayDates(weekStart: string): Record<string, string> {
  const start = parseDate(weekStart.slice(0, 10))
  const out: Record<string, string> = {}
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out[WEEKDAYS[(d.getDay() + 6) % 7]] = iso(d)
  }
  return out
}

export type DayStatus = { day: string; label: string; date: string; done: boolean }

// The plan's workout days with their date and whether each is done
export function workoutDayStatus(plan: TodayPlan, sessions: TodaySession[]): DayStatus[] {
  const dates = planDayDates(plan.week_start)
  const linked = sessions.filter(s => s.weekly_plan_id === plan.id)
  const doneDays = new Set(linked.filter(s => s.plan_day).map(s => dayKey(s.plan_day)))
  const otherDates = new Set(linked.filter(s => !s.plan_day).map(s => s.session_date))
  return summarizeAny(plan, plan.week_start).days
    .filter(label => !isRestDay(label))
    .map(label => ({ day: dayKey(label), label }))
    .filter(d => dates[d.day])
    .map(d => ({ ...d, date: dates[d.day], done: doneDays.has(d.day) || otherDates.has(dates[d.day]) }))
}

// Workout days before today that weren't done, and today's workout if it isn't done yet
export function missedAndDue(plan: TodayPlan, sessions: TodaySession[], today = localDateIso()) {
  const days = workoutDayStatus(plan, sessions)
  return {
    missed: days.filter(d => !d.done && d.date < today),
    dueToday: days.find(d => !d.done && d.date === today) ?? null,
  }
}

// Who logged a session: a staff id, or 'client' when the client logged it themselves
export const loggerOf = (s: TodaySession) => (s.logged_by && s.logged_by !== s.client_id ? s.logged_by : 'client')

// Sessions per logger: today and since `since` (e.g. this week's Monday)
export function sessionsByLogger(sessions: TodaySession[], since: string, today = localDateIso()) {
  const out: Record<string, { today: number; week: number }> = {}
  for (const s of sessions) {
    if (s.session_date < since || s.session_date > today) continue
    const t = (out[loggerOf(s)] ??= { today: 0, week: 0 })
    t.week++
    if (s.session_date === today) t.today++
  }
  return out
}

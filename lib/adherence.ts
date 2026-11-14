// Plan adherence: how many of a plan's workout days the client has done.
// A day counts as done when a session is logged against the plan with that day (plan_day),
// or, for sessions linked to the plan without a day (normal Log form), one per distinct date.
// 14 Nov: sessions with no plan link (weekly_plan_id empty: "Log today's session", older data)
// dated inside the plan's 7 days also count, one per date not already counted.
// Never counts more than the plan's workout days.

import { weekStatus, dayKey } from './plan-summary'
import { summarizeAny, WEEKDAYS } from './plan-structure'

export type AdherencePlan = { id: string; client_id?: string; week_start: string; plan_details: string; plan_json?: unknown }
export type AdherenceSession = { weekly_plan_id?: string | null; plan_day?: string | null; session_date: string; client_id?: string }

export type Adherence = { planned: number; done: number }

// 'YYYY-MM-DD' + n days (date only, no timezone shift)
function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

export function planAdherence(plan: AdherencePlan, sessions: AdherenceSession[]): Adherence | null {
  const planned = summarizeAny(plan).workoutDays
  if (!planned) return null // plan without readable workout days
  const linked = sessions.filter(s => s.weekly_plan_id === plan.id)
  const days = new Set(linked.filter(s => s.plan_day).map(s => dayKey(s.plan_day)))
  const otherDates = new Set(linked.filter(s => !s.plan_day).map(s => s.session_date))
  // Unlinked sessions inside the plan's week (same client when both say), on dates not already counted
  const start = plan.week_start.slice(0, 10), end = plusDays(start, 6)
  const linkedDates = new Set(linked.map(s => s.session_date.slice(0, 10)))
  const unlinkedDates = new Set(sessions
    .filter(s => !s.weekly_plan_id && (!s.client_id || !plan.client_id || s.client_id === plan.client_id))
    .map(s => s.session_date.slice(0, 10))
    .filter(d => d >= start && d <= end && !linkedDates.has(d)))
  return { planned, done: Math.min(planned, days.size + otherDates.size + unlinkedDates.size) }
}

// 14 Nov: a session dated BEFORE the plan it is linked to started (history logged later while a newer
// plan was picked, e.g. a backdated Log / Mark done) can't have been that plan's workout: it counts in
// the week it happened, like a session with no plan link (one per date, for the plan covering that date).
// Sessions logged late against an older plan (dated after it ended) keep their plan. Counting only:
// the saved rows are never changed. Plans not in `plans` leave their sessions as they are.
export function withoutEarlyLinks<T extends { weekly_plan_id?: string | null; session_date: string }>(
  sessions: T[], plans: { id: string; week_start: string }[],
): T[] {
  const starts = new Map(plans.map(p => [p.id, p.week_start.slice(0, 10)]))
  let changed = false
  const out = sessions.map(s => {
    const start = s.weekly_plan_id ? starts.get(s.weekly_plan_id) : undefined
    if (!start || s.session_date.slice(0, 10) >= start) return s
    changed = true
    return { ...s, weekly_plan_id: null }
  })
  return changed ? out : sessions
}

// Saving a session (14 Nov): the plan link to store for a session dated `date` when `chosenPlanId` is
// picked. Dated before that plan started (a backdated Log / Done ✓) → the plan covering that date
// (newest start wins), or no plan; the day label stays only if its weekday is the date's weekday, so it
// can't tick the wrong day of the other plan. Otherwise (in the plan's week, or logged late after it
// ended) the choice is kept. `moved` = the link was changed; `weekStart` = the plan it now points at.
export function linkForDate(
  plans: { id: string; week_start: string }[], chosenPlanId: string | null | undefined, date: string, planDay: string | null,
): { weekly_plan_id: string | null; plan_day: string | null; moved: boolean; weekStart: string | null } {
  const chosen = chosenPlanId ? plans.find(p => p.id === chosenPlanId) : undefined
  const day = date.slice(0, 10)
  if (!chosen || day >= chosen.week_start.slice(0, 10)) {
    return { weekly_plan_id: chosenPlanId || null, plan_day: planDay, moved: false, weekStart: chosen?.week_start.slice(0, 10) ?? null }
  }
  const covering = plans
    .filter(p => p.week_start.slice(0, 10) <= day && plusDays(p.week_start.slice(0, 10), 6) >= day)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))[0]
  if (!covering) return { weekly_plan_id: null, plan_day: planDay, moved: true, weekStart: null }
  const [y, m, d] = day.split('-').map(Number)
  const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7]
  return {
    weekly_plan_id: covering.id,
    plan_day: planDay && dayKey(planDay) === weekday ? planDay : null,
    moved: true,
    weekStart: covering.week_start.slice(0, 10),
  }
}

// The plan covering today (newest start wins if two overlap)
export function currentPlan<T extends AdherencePlan>(plans: T[]): T | null {
  return plans
    .filter(p => weekStatus(p.week_start) === 'current')
    .sort((a, b) => b.week_start.localeCompare(a.week_start))[0] ?? null
}

// Combined adherence over plans that started in the last `weeks` weeks and have started already
export function recentAdherence(plans: AdherencePlan[], sessions: AdherenceSession[], weeks = 4): Adherence | null {
  const since = new Date()
  since.setDate(since.getDate() - 7 * weeks)
  const sinceIso = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`
  let planned = 0, done = 0
  for (const p of plans) {
    if (p.week_start.slice(0, 10) < sinceIso || weekStatus(p.week_start) === 'upcoming') continue
    const a = planAdherence(p, sessions)
    if (a) { planned += a.planned; done += a.done }
  }
  return planned ? { planned, done } : null
}

export const pct = (a: Adherence | null) => (a && a.planned ? Math.round((a.done / a.planned) * 100) : null)

// Tailwind colour for a percentage: green 75%+, amber 40–74%, red below
export const pctColor = (p: number | null) =>
  p == null ? 'text-gray-500' : p >= 75 ? 'text-green-400' : p >= 40 ? 'text-amber-400' : 'text-red-400'

// Self-training members (19 Nov, client view build Part C). A member who isn't PT, in a gym with
// self_training_enabled (lib/clientSettings.ts isSelfTraining), builds their own plan in the client app.
//
// Their plan repeats every week until they edit it (Anand, 19 Nov). It is stored once: a weekly_plans row
// with created_by = the member and week_start = the Monday it was saved. Editing saves a NEW row from that
// week's Monday, so past weeks keep the plan they really had and nothing is overwritten (Rule #1).
//
// Every counter in the app (lib/adherence.ts, lib/monthly-report.ts, lib/progress-share.ts) expects one plan
// per week. expandOwnPlans turns each own plan into one in-memory copy per week it covers (id
// "<plan id>@<monday>") and points each session at the copy for its week, so those counters work unchanged.
// Nothing is saved: copies exist only on screen. realPlanId gives the stored id back for saving.

export type OwnPlanLike = { id: string; week_start: string; created_by?: string | null; client_id?: string; created_at?: string | null }
export type OwnSessionLike = { weekly_plan_id?: string | null; session_date: string }

const COPY = '@'

// 'YYYY-MM-DD' + n days, in UTC so the viewer's timezone can't move it
export function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Monday of the week a date falls in
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7))
  return t.toISOString().slice(0, 10)
}

export const isOwnPlan = (p: OwnPlanLike, clientId: string) => !!p.created_by && p.created_by === clientId

// Oldest first: by week, then by when it was saved (an edit in the same week is a newer row with the same
// Monday, so it must win; ids are random and say nothing about order), then id so the order is stable
const oldestFirst = (a: OwnPlanLike, b: OwnPlanLike) =>
  mondayOf(a.week_start).localeCompare(mondayOf(b.week_start))
  || (a.created_at || '').localeCompare(b.created_at || '')
  || a.id.localeCompare(b.id)
export const realPlanId = (id: string) => id.split(COPY)[0]
export const isPlanCopy = (id: string) => id.includes(COPY)

// The member's own plan in effect on a date: the newest own plan that started on or before that date's week
export function ownPlanOn<T extends OwnPlanLike>(plans: T[], clientId: string, date: string): T | null {
  const week = mondayOf(date)
  return plans
    .filter(p => isOwnPlan(p, clientId) && mondayOf(p.week_start) <= week)
    .sort((a, b) => oldestFirst(b, a))[0] ?? null
}

// Plans with one copy per week for every own plan (from its week to the week before the next own plan, or
// upTo's week), and sessions linked to any own plan pointed at the plan / copy covering their date.
// Plans the gym made, and sessions linked to them, are returned as they are.
export function expandOwnPlans<P extends OwnPlanLike, S extends OwnSessionLike>(
  plans: P[], sessions: S[], clientId: string, upTo: string,
): { plans: P[]; sessions: S[] } {
  const own = plans.filter(p => isOwnPlan(p, clientId))
    .sort(oldestFirst)
  if (!own.length) return { plans, sessions }
  const last = mondayOf(upTo)
  // One plan per week: a later plan saved for the same week wins (an edit on the same week)
  const byWeek = new Map<string, P>()
  for (const p of own) byWeek.set(mondayOf(p.week_start), p)
  const starts = [...byWeek.keys()].sort()
  const weekly = new Map<string, P>() // monday → the plan or its copy for that week
  starts.forEach((start, i) => {
    const p = byWeek.get(start)!
    const end = i + 1 < starts.length ? plusDays(starts[i + 1], -7) : last
    for (let w = start; w <= end; w = plusDays(w, 7)) {
      weekly.set(w, w === start && p.week_start.slice(0, 10) === start ? p
        : { ...p, id: `${p.id}${COPY}${w}`, week_start: w })
    }
  })
  const ownIds = new Set(own.map(p => p.id))
  const outPlans = [...plans.filter(p => !ownIds.has(p.id)), ...weekly.values()]
  const outSessions = sessions.map(s => {
    if (!s.weekly_plan_id || !ownIds.has(s.weekly_plan_id)) return s
    const cover = weekly.get(mondayOf(s.session_date))
    return cover && cover.id !== s.weekly_plan_id ? { ...s, weekly_plan_id: cover.id } : s
  })
  return { plans: outPlans, sessions: outSessions }
}

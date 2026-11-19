// The gym's reviewed monthly report (19 Nov, client view build Part C4): the numbers added to the monthly
// progress PDF for one member and month. Sessions and volume per week, new bests, stalled exercises, plan
// exercises not done for 2+ weeks, the coach's note and, for self-training members, a line inviting them to
// talk to the gym about a plateau (no WhatsApp link: they train at the gym and know who to ask, Anand 19 Nov).
// Generated only by the owner / partners / Super Admin (app/company/reports); members never see a button.
// Pure functions (check: scripts/check-self-training.ts).

import { type Exercise } from './exercises'
import { type PlanJson } from './plan-structure'
import { type MonthSummary } from './monthly-report'
import { type ProgressLog, type ProgressRange, exerciseRows, setsOf, setsVolume } from './progress'
import { mondayOf } from './self-training'

export type MonthReview = {
  weeks: { from: string; sessions: number; volume: number }[] // the month's Monday weeks (cut at its edges)
  newBests: string[]
  stalled: string[]
  notDone: string[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function monthReview(opts: {
  logs: ProgressLog[]
  library: Exercise[]
  plan: PlanJson | null   // the plan in effect at the end of the month (for "not done")
  summary: MonthSummary
}): MonthReview {
  const { summary } = opts
  const logs = opts.logs.filter(l => l.session_date.slice(0, 10) <= summary.upTo)
  const range: ProgressRange = {
    by: 'week', periods: summary.weeks.map(w => mondayOf(w.from)), start: summary.from, end: summary.upTo,
  }
  const rows = exerciseRows({ logs, library: opts.library, range, plan: opts.plan })
  return {
    weeks: summary.weeks.map(w => ({
      from: w.from,
      sessions: w.sessions,
      volume: round1(logs.filter(l => l.session_date >= w.from && l.session_date <= w.to)
        .reduce((n, l) => n + setsVolume(setsOf(l)), 0)),
    })),
    newBests: rows.filter(r => r.newBest).map(r => r.name),
    stalled: rows.filter(r => r.stalled).map(r => r.name),
    notDone: rows.filter(r => r.notDone).map(r => r.name),
  }
}

// "A, B and C"
export function listText(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

// The closing line for a self-training member's report; names the stalled exercises when there are any
export function plateauLine(gymName: string, stalled: string[]): string {
  const gym = gymName.trim() || 'the gym'
  return stalled.length
    ? `Want help breaking your plateau on ${listText(stalled.slice(0, 3))}? Talk to the ${gym} team on your next visit.`
    : `Want help setting your next goal? Talk to the ${gym} team on your next visit.`
}

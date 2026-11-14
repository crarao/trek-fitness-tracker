// Owner "Today" schedule (gyms and individual coaches): one day's PT sessions by workout time, and who trained.
// Read-only. Pure helpers (no Supabase), so scripts/check-today-schedule.ts can run them.
// Rules:
//  - Workout time is per plan (weekly_plans.workout_time, one time for the plan's week; "18:30" from the time
//    picker or older free text like "6 pm", read with timeMinutes).
//  - Expected on a day = the plan covering that day (planCovering) has a workout day on it, or is a "Day 1, Day 2…"
//    plan that can't be dated (counted as expected every day of its week). Rest day / no plan = not expected.
//  - Trained = any logged_sessions row for the client on that date (newest one names who logged it).
//  - Status of an expected client with no session:
//      past day → Not logged; future day → Expected;
//      today → Not logged once GRACE_MINUTES have passed since the workout time, else Expected
//      (no readable time → Expected today: we can't tell).
//  - Covering = a staff member other than the client's primary coach logged it (only when the client has one).
//  - Only active PT clients: not archived, and the latest membership (newest start_date) hasn't ended before the
//    date. No membership saved = kept.
//  - "Now" and "today" are the device's local time (IST for Indian gyms), like the rest of the app.

import { type CoachClient, type CoachPlan, type CoachSession, planCovering, todayDayOf, timeMinutes, loggedByLabel, isCovering } from './coach-today'
import { loggerOf } from './todays-sessions'
import { type Country } from './locale'

export const GRACE_MINUTES = 60

export type ScheduleStatus = 'trained' | 'expected' | 'not-logged'
export type ScheduleMembership = { profile_id: string; start_date: string; end_date: string | null }

export type ScheduleRow = {
  client: CoachClient
  coachId: string | null        // primary coach (assigned), soft link
  workoutTime: string | null    // as saved on the plan
  minutes: number | null        // minutes after midnight, null = no readable time
  dayLabel: string | null       // "Upper Body Push", "This week’s plan"
  scheduled: boolean            // expected on this date by their plan
  reason: 'no-time' | 'no-plan' | 'rest' | null  // why it isn't a time slot
  status: ScheduleStatus | null // null = not scheduled and didn't train
  trainedBy: string | null      // "Coach Ravi", "Anand", "client"
  loggerId: string | null       // staff id, or 'client'
  covering: boolean             // logged by staff who isn't the primary coach
}

export type DaySchedule = {
  slots: ScheduleRow[]          // scheduled with a readable time, by time then name
  noTime: ScheduleRow[]         // scheduled without a readable time, then no plan this week (didn't train)
  alsoTrained: ScheduleRow[]    // trained though not on their plan that day (rest day / no plan)
  summary: { expected: number; trained: number; notLogged: number }
}

const newestFirst = (a: CoachSession, b: CoachSession) => (b.created_at || '').localeCompare(a.created_at || '')

// Latest membership (newest start_date) ended before `date` = expired that day
export function expiredOn(memberships: ScheduleMembership[], date: string): Set<string> {
  const latest: Record<string, ScheduleMembership> = {}
  for (const m of memberships) {
    if (!latest[m.profile_id] || m.start_date > latest[m.profile_id].start_date) latest[m.profile_id] = m
  }
  return new Set(Object.values(latest).filter(m => m.end_date && m.end_date.slice(0, 10) < date).map(m => m.profile_id))
}

export function buildDaySchedule(opts: {
  clients: CoachClient[]
  plans: CoachPlan[]
  sessions: CoachSession[]          // sessions on (at least) `date`
  memberships: ScheduleMembership[]
  staffNames: Record<string, string>
  coachIds?: Set<string>            // coach logins (get the "Coach" word)
  date: string                      // the day shown, YYYY-MM-DD
  today: string                     // device today, YYYY-MM-DD
  nowMinutes: number                // minutes after midnight now (device)
  word?: string
}): DaySchedule {
  const { clients, plans, sessions, memberships, staffNames, coachIds, date, today, nowMinutes, word = 'Coach' } = opts
  const expired = expiredOn(memberships, date)
  const rows: ScheduleRow[] = clients
    .filter(c => !c.archived_at && (c.client_type ?? 'pt') === 'pt' && !expired.has(c.id))
    .map(c => {
      const mine = sessions.filter(s => s.client_id === c.id)
      const plan = planCovering(plans.filter(p => p.client_id === c.id), date)
      const day = todayDayOf(plan, mine, date)
      const scheduled = typeof day !== 'string'
      const workoutTime = plan?.workout_time?.trim() || null
      const minutes = timeMinutes(workoutTime)
      const done = mine.filter(s => s.session_date === date).sort(newestFirst)[0]
      let status: ScheduleStatus | null = null
      if (done) status = 'trained'
      else if (scheduled) {
        if (date < today) status = 'not-logged'
        else if (date > today) status = 'expected'
        else status = minutes != null && nowMinutes >= minutes + GRACE_MINUTES ? 'not-logged' : 'expected'
      }
      const loggerId = done ? loggerOf(done) : null
      return {
        client: c,
        coachId: c.primary_coach_id || null,
        workoutTime,
        minutes,
        dayLabel: scheduled ? (day as { label: string }).label : null,
        scheduled,
        reason: scheduled ? (minutes == null ? 'no-time' : null) : day === 'rest' ? 'rest' : 'no-plan',
        status,
        trainedBy: done ? loggedByLabel(done, staffNames, word, coachIds) : null,
        loggerId,
        covering: !!done && !!c.primary_coach_id && isCovering(done, c),
      }
    })

  const byName = (a: ScheduleRow, b: ScheduleRow) => a.client.full_name.localeCompare(b.client.full_name)
  const slots = rows.filter(r => r.scheduled && r.minutes != null).sort((a, b) => a.minutes! - b.minutes! || byName(a, b))
  const noTime = [
    ...rows.filter(r => r.scheduled && r.minutes == null).sort(byName),
    ...rows.filter(r => r.reason === 'no-plan' && r.status !== 'trained').sort(byName),
  ]
  const alsoTrained = rows.filter(r => !r.scheduled && r.status === 'trained').sort(byName)
  const scheduled = rows.filter(r => r.scheduled)
  return {
    slots,
    noTime,
    alsoTrained,
    summary: {
      expected: scheduled.length,
      trained: rows.filter(r => r.status === 'trained').length,
      notLogged: scheduled.filter(r => r.status === 'not-logged').length,
    },
  }
}

// Rows for one coach's day: their assigned clients, plus anyone they logged (covering)
export function forCoach(rows: ScheduleRow[], coachId: string | null): ScheduleRow[] {
  if (!coachId) return rows
  if (coachId === 'none') return rows.filter(r => !r.coachId)
  return rows.filter(r => r.coachId === coachId || r.loggerId === coachId)
}

// "6:30 pm" (IN / AE) or "6:30 PM" (US / CA); "6 pm" on the hour
export function timeLabel(minutes: number, country: Country): string {
  const h = Math.floor(minutes / 60), m = minutes % 60
  const h12 = h % 12 || 12
  const ap = h < 12 ? 'am' : 'pm'
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${country === 'US' || country === 'CA' ? ap.toUpperCase() : ap}`
}

// A plan's workout time for display: "18:30" / "11:00:00" -> "6:30 pm" / "11 am" (US / CA: "PM");
// text that isn't a readable time is shown as typed; empty -> ''
export function workoutTimeLabel(text: string | null | undefined, country: Country | null | undefined): string {
  const t = (text || '').trim()
  if (!t) return ''
  const m = timeMinutes(t)
  return m == null ? t : timeLabel(m, country ?? 'IN')
}

// Hour heading for a slot: "6 pm"
export const hourLabel = (minutes: number, country: Country) => timeLabel(Math.floor(minutes / 60) * 60, country)

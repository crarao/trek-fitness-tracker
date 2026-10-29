// Coach home (ROADMAP #40): today's training list for a gym's PT clients, the "Before you start" card,
// and who is covering for whom. Pure helpers (no Supabase), so scripts/check-coach-today.ts can run them.
// Rules:
//  - A gym coach home is a training list, not a chase list: who is expected today and whether they trained.
//  - Today's workout comes from the plan covering today (7 days from its start; newest start wins).
//  - The primary coach (profiles.primary_coach_id) is a soft link: any coach can train any PT client.
//  - Covering = a staff member logs a session for a client whose primary coach is someone else (or who has none).
//  - Dates are plain YYYY-MM-DD strings (localDateIso / parseDate), never new Date('YYYY-MM-DD').

import { parseDate } from './locale'
import { type TodayPlan, type TodaySession, planDayDates, workoutDayStatus, loggerOf } from './todays-sessions'
import { type ExercisesDone } from './plan-structure'
import { activityText } from './activities'

export type CoachClient = {
  id: string
  full_name: string
  phone?: string | null
  primary_coach_id?: string | null
  archived_at?: string | null
  client_type?: string | null
  goal?: string | null
  medical_conditions?: string | null
}
export type CoachPlan = TodayPlan & { client_id: string; workout_time?: string | null }
export type CoachSession = TodaySession & { notes?: string | null; created_at?: string | null }
export type StaffMember = { id: string; full_name: string }

export type TodayDay = { label: string } | 'rest' | 'no-plan'
export type DoneToday = { by: string; exercises: string | null; minutes: number | null }
export type TodayRow = {
  client: CoachClient
  primaryCoach: string | null   // first name, "You", or null (no primary coach)
  isMine: boolean
  todayDay: TodayDay
  workoutTime: string | null
  doneToday: DoneToday | null
  lastSessionDate: string | null
}

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || ''

// "Coach Ravi" for a staff logger, "client" when the client logged it themselves
export function loggedByLabel(s: CoachSession, names: Record<string, string>): string {
  const id = loggerOf(s)
  if (id === 'client') return 'client'
  const first = firstName(names[id])
  return first ? `Coach ${first}` : 'Coach'
}

// "6/7" from a session's ticked exercises, or null
export function exercisesText(s: { exercises_done?: unknown }): string | null {
  const ex = s.exercises_done as ExercisesDone | null | undefined
  return ex && Array.isArray(ex.done) && ex.total ? `${ex.done.length}/${ex.total}` : null
}

// Newest first: by date, then by when it was saved
const newestFirst = (a: CoachSession, b: CoachSession) =>
  b.session_date.localeCompare(a.session_date) || (b.created_at || '').localeCompare(a.created_at || '')

// The plan whose 7 days include `today` (newest start wins if two overlap)
export function planCovering<T extends CoachPlan>(plans: T[], today: string): T | null {
  return plans
    .filter(p => Object.values(planDayDates(p.week_start)).includes(today))
    .sort((a, b) => b.week_start.localeCompare(a.week_start))[0] ?? null
}

// Today's workout from the plan covering today. Plans headed "Day 1, Day 2…" can't be dated: shown as this week's plan.
export function todayDayOf(plan: CoachPlan | null, sessions: CoachSession[], today: string): TodayDay {
  if (!plan) return 'no-plan'
  const days = workoutDayStatus(plan, sessions)
  const d = days.find(x => x.date === today)
  if (d) return { label: d.label }
  return days.length ? 'rest' : { label: 'This week’s plan' }
}

// One row per active PT client
export function todayRows(
  clients: CoachClient[],
  plans: CoachPlan[],
  sessions: CoachSession[],
  coaches: StaffMember[],
  me: string,
  today: string
): TodayRow[] {
  const names = Object.fromEntries(coaches.map(c => [c.id, c.full_name]))
  return clients
    .filter(c => !c.archived_at && (c.client_type ?? 'pt') === 'pt')
    .map(c => {
      const mine = sessions.filter(s => s.client_id === c.id).sort(newestFirst)
      const plan = planCovering(plans.filter(p => p.client_id === c.id), today)
      const latestToday = mine.find(s => s.session_date === today)
      return {
        client: c,
        primaryCoach: !c.primary_coach_id ? null : c.primary_coach_id === me ? 'You' : firstName(names[c.primary_coach_id]) || 'Coach',
        isMine: !!c.primary_coach_id && c.primary_coach_id === me,
        todayDay: todayDayOf(plan, mine, today),
        workoutTime: plan?.workout_time?.trim() || null,
        doneToday: latestToday
          ? { by: loggedByLabel(latestToday, names), exercises: exercisesText(latestToday), minutes: latestToday.duration_minutes ?? null }
          : null,
        lastSessionDate: mine[0]?.session_date ?? null,
      }
    })
}

// Minutes after midnight from a plan's free-text workout time ("6:00 pm", "7 am", "18:30"); null if unreadable
export function timeMinutes(text: string | null | undefined): number | null {
  const m = (text || '').match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] || 0)
  const ap = (m[3] || '').toLowerCase()
  if (ap.startsWith('p') && h < 12) h += 12
  if (ap.startsWith('a') && h === 12) h = 0
  return h < 24 && min < 60 ? h * 60 + min : null
}

// Workouts today first (by workout time, no time last, then name); rest days, then no plan
export function sortRows(rows: TodayRow[]): TodayRow[] {
  const group = (r: TodayRow) => (r.todayDay === 'no-plan' ? 2 : r.todayDay === 'rest' ? 1 : 0)
  const time = (r: TodayRow) => timeMinutes(r.workoutTime) ?? Infinity
  return [...rows].sort((a, b) =>
    group(a) - group(b)
    || (group(a) === 0 ? time(a) - time(b) : 0)
    || a.client.full_name.localeCompare(b.client.full_name))
}

export type BeforeYouStart = {
  goal: string | null
  medical: string | null
  lastTwo: { date: string; day: string | null; exercises: string | null; minutes: number | null; notes: string | null; by: string }[]
  totalSessions: number
  daysSinceLast: number | null
}

// What a coach should know before training the client: goal, injuries, the last two sessions
export function beforeYouStart(
  client: CoachClient,
  sessions: CoachSession[],
  staffNames: Record<string, string>,
  today: string
): BeforeYouStart {
  const mine = sessions.filter(s => s.client_id === client.id && s.session_date <= today).sort(newestFirst)
  const last = mine[0]?.session_date
  return {
    goal: client.goal?.trim() || null,
    medical: client.medical_conditions?.trim() || null,
    lastTwo: mine.slice(0, 2).map(s => ({
      date: s.session_date,
      day: s.plan_day || (s.activity ? activityText(s.activity) : null),
      exercises: exercisesText(s),
      minutes: s.duration_minutes ?? null,
      notes: s.notes?.trim() || null,
      by: loggedByLabel(s, staffNames),
    })),
    totalSessions: mine.length,
    daysSinceLast: last ? Math.round((parseDate(today).getTime() - parseDate(last).getTime()) / 86400000) : null,
  }
}

// True when staff (a session's logger, or the viewer's id) isn't the client's primary coach.
// A session the client logged themselves is never covering.
export function isCovering(
  by: { logged_by?: string | null; client_id?: string } | string | null | undefined,
  client: { id: string; primary_coach_id?: string | null }
): boolean {
  const staffId = typeof by === 'string' ? by : by?.logged_by
  if (!staffId || staffId === client.id) return false
  return staffId !== client.primary_coach_id
}

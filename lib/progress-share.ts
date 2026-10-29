// Coach shares a client's week (or one session) on WhatsApp: builds the message text.
// Pure functions, no Supabase calls, so the wording can be checked with sample data
// (scripts/check-progress-share.ts). The page opens wa.me/<toPhone>?text=… like the
// membership reminders on the owner dashboard.

import { type Country, dialCode, formatDate, parseDate } from './locale'
import { localToday } from './plan-summary'
import { planAdherence } from './adherence'
import { missedAndDue, type TodaySession } from './todays-sessions'
import { estimateKcal } from './calories'
import { parseActivity } from './activities'
import { sessionsInWeek } from './weekly-totals'

export type ShareClient = {
  full_name: string
  phone: string | null
  weight_kg?: number | null
  // Dojo students (columns may not exist yet: then undefined and the message goes to the client)
  guardian_name?: string | null
  guardian_relation?: string | null
  guardian_phone?: string | null
}

export type SharePlan = { id: string; week_start: string; plan_details: string; plan_json?: unknown }

export type ShareSession = {
  session_date: string
  duration_minutes: number | null
  weekly_plan_id?: string | null
  plan_day?: string | null
  exercises_done?: unknown
  activity?: string | null
}

export type ShareResult = { text: string; toPhone: string | null; toLabel: string }

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_LINES = 10

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || ''

function addDays(iso: string, n: number): string {
  const d = parseDate(iso.slice(0, 10))
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Phone as wa.me wants it (country code + 10 digits), same rule as the owner dashboard's
// reminders (10 digits after removing spaces and symbols); a leading 0 or the country code is tolerated.
export function waPhone(raw: string | null | undefined, country: Country): string | null {
  let digits = (raw || '').replace(/\D/g, '')
  const code = dialCode(country)
  if (digits.length === 10 + code.length && digits.startsWith(code)) digits = digits.slice(code.length)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits.length === 10 ? code + digits : null
}

// "+91 98xxx xx432" for the To: line
export function maskPhone(toPhone: string | null, country: Country): string {
  if (!toPhone) return ''
  const code = dialCode(country)
  const n = toPhone.slice(code.length)
  return `+${code} ${n.slice(0, 2)}xxx xx${n.slice(7)}`
}

// Who the message goes to: the guardian when a guardian phone is set, otherwise the client
function recipient(client: ShareClient, country: Country) {
  const guardianPhone = waPhone(client.guardian_phone, country)
  if (guardianPhone) {
    const name = (client.guardian_name || '').trim()
    const relation = (client.guardian_relation || '').trim()
    const toLabel = relation && name ? `${relation} (${name})` : relation || name || 'Guardian'
    return { toPhone: guardianPhone, toLabel, guardian: true, greetName: firstName(name) }
  }
  return { toPhone: waPhone(client.phone, country), toLabel: client.full_name, guardian: false, greetName: firstName(client.full_name) }
}

// "Tue · Upper Body Push · 6/7 exercises · 60 min" (parts without data are left out)
export function sessionLine(s: ShareSession): string {
  const label = s.plan_day?.trim()
    || [WEEKDAY[parseDate(s.session_date.slice(0, 10)).getDay()], (() => {
      const a = parseActivity(s.activity)
      return a ? a.name || a.activity.label : ''
    })()].filter(Boolean).join(' · ')
  const ex = s.exercises_done as { done?: unknown; total?: unknown } | null | undefined
  const exText = ex && Array.isArray(ex.done) && typeof ex.total === 'number' && ex.total > 0 ? `${ex.done.length}/${ex.total} exercises` : ''
  const min = s.duration_minutes && s.duration_minutes > 0 ? `${s.duration_minutes} min` : ''
  return [label, exText, min].filter(Boolean).join(' · ')
}

// The numbers for one week (also used by the PDF report, lib/progress-pdf.ts)
export type WeekSummary = {
  sessions: ShareSession[]   // every session logged inside the week, in date order (= the chart's bar)
  planned: number            // workout days in the plan (0 = no plan or no readable days)
  done: number               // distinct planned days done this week (never more than planned)
  extra: number              // sessions beyond the planned days done ("+1 extra session"; 0 without a plan)
  missed: string[]           // planned weekdays already passed with nothing logged ("Thu")
  minutes: number
  kcal: number               // 0 when it can't be estimated (no weight)
}

export function summarizeWeek(opts: {
  plan: SharePlan | null
  sessions: ShareSession[]
  weekStart: string
  weightKg?: number | null
  businessType?: string | null
  today?: string
}): WeekSummary {
  const { plan, weekStart } = opts
  const today = opts.today ?? localToday()
  // One counting rule for the card, the session list, the charts and "Last 4 weeks" (29 Oct):
  // every session logged Monday–Sunday counts, the same filter as the chart bars (lib/weekly-totals.ts)
  const sessions = sessionsInWeek(opts.sessions, weekStart)
    .sort((a, b) => a.session_date.localeCompare(b.session_date))
  // Days done use the app's rule (only sessions saved against the plan, one per plan day),
  // counted over this week's sessions only, so the card can't be more than the list
  const adherence = plan ? planAdherence(plan, sessions) : null
  const planned = adherence?.planned ?? 0
  const done = adherence?.done ?? 0
  const extra = planned ? sessions.length - done : 0
  const missed = plan ? missedAndDue(plan, opts.sessions as TodaySession[], today).missed.map(d => d.day) : []
  const minutes = sessions.reduce((n, s) => n + (s.duration_minutes || 0), 0)
  const kcal = sessions.reduce((n, s) => n + (estimateKcal({
    minutes: s.duration_minutes, weightKg: opts.weightKg, label: s.plan_day, activity: s.activity, businessType: opts.businessType,
  }) || 0), 0)
  return { sessions, planned, done, extra, missed, minutes, kcal }
}

// The plan the report uses for a week: the one covering the same weekday as today in that week
// (today for This week, a week ago for Last week); newest start wins if two overlap
export function planForWeek<T extends SharePlan>(plans: T[], weekStart: string, today = localToday()): T | null {
  const ref = addDays(weekStart, (parseDate(today).getDay() + 6) % 7)
  return plans
    .filter(p => p.week_start.slice(0, 10) <= ref && addDays(p.week_start, 6) >= ref)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))[0] ?? null
}

// "Last 4 weeks" on the report: planned days done over the 4 Monday weeks ending with `weekStart`,
// each counted with summarizeWeek like the week card (null when none of them had a plan)
export function recentWeeksAdherence(opts: {
  plans: SharePlan[]
  sessions: ShareSession[]
  weekStart: string
  weeks?: number
  today?: string
}): { done: number; planned: number } | null {
  let done = 0, planned = 0
  for (let i = 0; i < (opts.weeks ?? 4); i++) {
    const weekStart = addDays(opts.weekStart, -7 * i)
    const w = summarizeWeek({ plan: planForWeek(opts.plans, weekStart, opts.today), sessions: opts.sessions, weekStart, today: opts.today })
    done += w.done
    planned += w.planned
  }
  return planned ? { done, planned } : null
}

// Chart weeks (Monday–Sunday), shared with the Progress tab: lib/weekly-totals.ts
export { weeklyTotals } from './weekly-totals'

const signOff = (coachName: string | null | undefined, companyName: string) =>
  `— ${[firstName(coachName), companyName].filter(Boolean).join(', ')}`

export function buildProgressMessage(opts: {
  client: ShareClient
  companyName: string
  businessType?: string | null
  coachName?: string | null
  plan: SharePlan | null
  sessions: ShareSession[]
  weekStart: string        // 'YYYY-MM-DD', first day of the week being shared
  note?: string
  country?: Country
  today?: string           // 'YYYY-MM-DD'; defaults to this device's date (set in checks)
}): ShareResult {
  const { client, companyName, businessType, coachName, plan, weekStart } = opts
  const country = opts.country ?? 'IN'
  const today = opts.today ?? localToday()
  const week = summarizeWeek({ plan, sessions: opts.sessions, weekStart, weightKg: client.weight_kg, businessType, today })
  const { sessions, planned, done, extra, missed, minutes, kcal } = week
  const to = recipient(client, country)
  const isCurrent = today >= weekStart && today <= addDays(weekStart, 6)
  const out: string[] = []

  out.push(to.guardian
    ? `Hi ${to.greetName || 'there'}, here's ${firstName(client.full_name)}'s week at ${companyName}`
    : `Hi ${to.greetName || 'there'}, here's your week at ${companyName}`)
  out.push(`Week of ${formatDate(weekStart, country, 'dayMonth')}`)

  if (!sessions.length) {
    const emoji = businessType === 'martial_arts' ? '🥋' : '💪'
    out.push('', `No sessions logged ${isCurrent ? 'this' : 'that'} week. Let's get back on track ${emoji}`)
  } else {
    if (planned) {
      out.push('', `✅ ${done} of ${planned} sessions done`)
    } else {
      out.push('', `✅ ${sessions.length} session${sessions.length === 1 ? '' : 's'} logged`)
    }

    const lines = sessions.map(sessionLine).filter(Boolean)
    out.push(...lines.slice(0, MAX_LINES))
    if (lines.length > MAX_LINES) out.push(`+${lines.length - MAX_LINES} more`)
    if (extra > 0) out.push(`+${extra} extra session${extra === 1 ? '' : 's'}`)

    if (missed.length) out.push(`Missed: ${missed.join(', ')}`)

    const totals = [minutes ? `⏱ ${minutes} min` : '', kcal ? `🔥 about ${kcal.toLocaleString('en-US')} kcal (estimate)` : ''].filter(Boolean)
    if (totals.length) out.push('', totals.join(' · '))
  }

  const note = (opts.note || '').trim()
  if (note) out.push('', note)
  out.push('', signOff(coachName, companyName))

  return { text: out.join('\n'), toPhone: to.toPhone, toLabel: to.toLabel }
}

// One session, sent right after the coach marks it done:
// "Hi Rohan, great session today: Tue · Upper Body Push · 6/7 exercises · 60 min 💪 — Priya"
export function buildSessionMessage(opts: {
  client: ShareClient
  companyName: string
  businessType?: string | null
  coachName?: string | null
  session: ShareSession
  country?: Country
  today?: string
}): ShareResult {
  const { client, session } = opts
  const country = opts.country ?? 'IN'
  const to = recipient(client, country)
  const when = session.session_date === (opts.today ?? localToday()) ? 'today' : `on ${formatDate(session.session_date, country, 'weekday')}`
  const emoji = opts.businessType === 'martial_arts' ? '🥋' : '💪'
  const greeting = to.guardian
    ? `Hi ${to.greetName || 'there'}, ${firstName(client.full_name)} had a great session ${when}`
    : `Hi ${to.greetName || 'there'}, great session ${when}`
  const line = sessionLine(session)
  const coach = firstName(opts.coachName)
  const text = `${greeting}${line ? `: ${line}` : '!'} ${emoji}${coach ? ` — ${coach}` : ` — ${opts.companyName}`}`
  return { text, toPhone: to.toPhone, toLabel: to.toLabel }
}

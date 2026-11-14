// Monthly progress report (Share progress → Month): the numbers for one calendar month (1st to the
// last day; the current month runs to today, "so far"), the month picker's options, and the
// WhatsApp message. Pure functions, no Supabase calls (check: scripts/check-monthly-report.ts).
//
// Counting rules (the same as the weekly report, lib/progress-share.ts summarizeWeek):
//  - Sessions / minutes: every session dated inside the range.
//  - Planned days: each plan's workout days, placed on their dates (lib/todays-sessions.ts
//    planDayDates). When two plans cover the same date, the newer start owns it. In the current
//    month only days up to today count, so the 3rd of the month doesn't read "2 of 18".
//  - Done: a session saved against the plan with that day (plan_day, whatever date it was logged
//    on), plus one per date for sessions linked to the plan without a day or logged with no plan
//    link at all (14 Nov rule). Never more than the planned days.
//  - Plans whose days can't be dated ("Day 1, Day 2…" text plans) count in the week they start.
//  - The month is the sum of its weeks (Monday weeks cut at the month's edges), so the week
//    lines in the message always add up to the month line.

import { type Country, formatDate, parseDate, greet } from './locale'
import { localToday, dayKey, isRestDay } from './plan-summary'
import { summarizeAny } from './plan-structure'
import { planAdherence } from './adherence'
import { planDayDates } from './todays-sessions'
import { mondayOf } from './weekly-totals'
import { estimateKcal } from './calories'
import { monthlyProgress, type DatedLog, weightText } from './exercise-logs'
import type { Exercise } from './exercises'
import { type ShareClient, type SharePlan, type ShareSession, type ShareResult, waPhone } from './progress-share'
import { pickRecipient } from './guardian'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (date: string, n: number) => { const d = parseDate(date.slice(0, 10)); d.setDate(d.getDate() + n); return iso(d) }
const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || ''

// ---- Months ----

// "2026-11" → first and last day. Built with Date(year, month, 0), so December → January and
// February in leap years come out right.
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
}

// The month before / after "2026-01" → "2025-12"
export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const MONTHS_BACK = 12      // the month picker offers at most this many months
export const LAST_MONTH_UNTIL = 5  // on the 1st–5th the picker starts on last month (like Mon / Tue → Last week)

export type MonthOption = { month: string; label: string; current: boolean }

// Newest first: this month ("Nov 2026 (so far)"), then back to the month the client joined or first
// trained (whichever is earlier), at most MONTHS_BACK months. Every label has its year, so
// "Dec 2026" and "Jan 2027" can't be mixed up.
export function monthOptions(opts: { today?: string; since?: string | null; country: Country; max?: number }): MonthOption[] {
  const today = opts.today ?? localToday()
  const thisMonth = today.slice(0, 7)
  const first = opts.since && opts.since.slice(0, 7) < thisMonth ? opts.since.slice(0, 7) : thisMonth
  const out: MonthOption[] = []
  for (let m = thisMonth; m >= first && out.length < (opts.max ?? MONTHS_BACK); m = shiftMonth(m, -1)) {
    const label = formatDate(`${m}-01`, opts.country, 'monthYear')
    out.push({ month: m, label: m === thisMonth ? `${label} (so far)` : label, current: m === thisMonth })
  }
  return out
}

// The month the picker starts on: last month on the 1st–5th (when it is in the list), else this month
export function defaultMonth(options: MonthOption[], today = localToday()): string {
  const early = Number(today.slice(8, 10)) <= LAST_MONTH_UNTIL
  return (early && options[1]?.month) || options[0]?.month || today.slice(0, 7)
}

// ---- Counting ----

export type RangeCount = { planned: number; done: number; sessions: number; minutes: number }

// Planned / done plan days and sessions between two dates (inclusive). Plans and sessions as the
// client page holds them.
export function countRange(plans: SharePlan[], sessions: ShareSession[], from: string, to: string): RangeCount {
  const inRange = sessions.filter(s => { const d = s.session_date.slice(0, 10); return d >= from && d <= to })
  const out: RangeCount = { planned: 0, done: 0, sessions: inRange.length, minutes: inRange.reduce((n, s) => n + (s.duration_minutes || 0), 0) }
  if (from > to) return out

  // Which plan owns each date (newest start wins when two cover it)
  const owner = new Map<string, SharePlan>()
  const byStart = [...plans].sort((a, b) => a.week_start.localeCompare(b.week_start))
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const p of byStart) {
      const start = p.week_start.slice(0, 10)
      if (start <= d && addDays(start, 6) >= d) owner.set(d, p)
    }
  }

  for (const p of byStart) {
    const start = p.week_start.slice(0, 10)
    const summary = summarizeAny(p, start)
    const dates = planDayDates(start)
    const workout = summary.days.filter(l => !isRestDay(l)).map(dayKey)
    const dated = workout.filter(k => dates[k])
    const linked = sessions.filter(s => s.weekly_plan_id === p.id)
    const dayDone = new Set(linked.filter(s => s.plan_day).map(s => dayKey(s.plan_day)))
    const dayDates = new Set(linked.filter(s => s.plan_day).map(s => s.session_date.slice(0, 10)))

    if (!dated.length) {
      // Undatable plan ("Day 1, Day 2…"): counted whole in the range its start falls in
      if (!summary.workoutDays || start < from || start > to) continue
      // planAdherence already counts sessions with no plan link inside the plan's week (14 Nov)
      out.planned += summary.workoutDays
      out.done += planAdherence(p, sessions)?.done ?? 0
      continue
    }

    // Workout days whose date is in the range and owned by this plan
    const own = dated.filter(k => dates[k] >= from && dates[k] <= to && owner.get(dates[k]) === p)
    if (!own.length) continue
    const ownDates = new Set(own.map(k => dates[k]))
    const matched = own.filter(k => dayDone.has(k)).length
    // One per date: sessions linked without a day, or with no plan link, on this plan's dates in the range
    const credits = new Set(sessions
      .filter(s => (s.weekly_plan_id === p.id && !s.plan_day) || !s.weekly_plan_id)
      .map(s => s.session_date.slice(0, 10))
      .filter(d => ownDates.has(d) && !dayDates.has(d)))
    out.planned += own.length
    out.done += Math.min(own.length, matched + credits.size)
  }
  return out
}

export type MonthWeek = RangeCount & { from: string; to: string }

export type MonthSummary = RangeCount & {
  month: string          // "2026-11"
  from: string           // the 1st
  to: string             // the last day of the month
  upTo: string           // last day counted: today in the current month, else `to`
  current: boolean
  weeks: MonthWeek[]     // Monday weeks cut at the month's edges (and at today), oldest first
  activeDays: number     // distinct dates with a session
  kcal: number           // 0 when it can't be estimated (no weight)
}

export function summarizeMonth(opts: {
  plans: SharePlan[]
  sessions: ShareSession[]
  month: string
  today?: string
  weightKg?: number | null
  businessType?: string | null
}): MonthSummary {
  const today = opts.today ?? localToday()
  const { from, to } = monthBounds(opts.month)
  const current = today >= from && today <= to
  const upTo = current ? today : to
  const weeks: MonthWeek[] = []
  for (let start = from; start <= upTo; start = addDays(mondayOf(start), 7)) {
    const end = [addDays(mondayOf(start), 6), upTo].sort()[0]
    weeks.push({ from: start, to: end, ...countRange(opts.plans, opts.sessions, start, end) })
  }
  const inMonth = opts.sessions.filter(s => { const d = s.session_date.slice(0, 10); return d >= from && d <= upTo })
  return {
    month: opts.month, from, to, upTo, current, weeks,
    planned: weeks.reduce((n, w) => n + w.planned, 0),
    done: weeks.reduce((n, w) => n + w.done, 0),
    sessions: inMonth.length,
    minutes: inMonth.reduce((n, s) => n + (s.duration_minutes || 0), 0),
    activeDays: new Set(inMonth.map(s => s.session_date.slice(0, 10))).size,
    kcal: inMonth.reduce((n, s) => n + (estimateKcal({
      minutes: s.duration_minutes, weightKg: opts.weightKg, label: s.plan_day, activity: s.activity, businessType: opts.businessType,
    }) || 0), 0),
  }
}

export type MonthTotal = { month: string; sessions: number; minutes: number }

// Sessions and minutes per month for the PDF charts, oldest first, ending with `lastMonth`
export function monthlyTotals(sessions: ShareSession[], lastMonth: string, count = 6): MonthTotal[] {
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(lastMonth, i - (count - 1))
    const inMonth = sessions.filter(s => s.session_date.slice(0, 7) === month)
    return { month, sessions: inMonth.length, minutes: inMonth.reduce((n, s) => n + (s.duration_minutes || 0), 0) }
  })
}

export type StrengthGain = { name: string; from: number; to: number }

// Exercises whose heaviest weight this month beat the last earlier month with a weight
// ("Squat 60 → 70 kg"), most logged first. Logs after `upTo` are left out.
export function strengthGains(logs: DatedLog[], library: Exercise[], month: string, upTo: string, max = 3): StrengthGain[] {
  const out: StrengthGain[] = []
  for (const p of monthlyProgress(logs.filter(l => l.session_date.slice(0, 10) <= upTo), library)) {
    const cur = p.points.find(x => x.period === month)?.topWeight
    const prev = [...p.points].reverse().find(x => x.period < month && x.topWeight)?.topWeight
    if (cur && prev && cur > prev) out.push({ name: p.name, from: prev, to: cur })
    if (out.length >= max) break
  }
  return out
}

// ---- Text ----

// "1–30 Nov 2026", "1–14 Nov 2026 (so far)"
export function monthRangeText(s: Pick<MonthSummary, 'from' | 'upTo' | 'current'>, country: Country): string {
  const end = formatDate(s.upTo, country, 'medium')
  const startDay = Number(s.from.slice(8, 10))
  const text = country === 'US' || country === 'CA'
    ? end.replace(/^(\w+) (\d+),/, `$1 ${startDay}–$2,`)   // Nov 1–30, 2026
    : `${startDay}–${end}`                                  // 1–30 Nov 2026
  return s.current ? `${text} (so far)` : text
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// One week's line: "3 Nov: 4 of 5" / "10 Nov: 2 sessions" / null when the week has nothing to say
export function weekLine(w: MonthWeek, country: Country): string | null {
  if (!w.planned && !w.sessions) return null
  const label = formatDate(w.from, country, 'dayMonth')
  return `${label}: ${w.planned ? `${w.done} of ${w.planned}` : plural(w.sessions, 'session')}`
}

export function buildMonthlyMessage(opts: {
  client: ShareClient
  companyName: string
  businessType?: string | null
  coachName?: string | null
  summary: MonthSummary
  gains?: StrengthGain[]
  note?: string
  country?: Country
}): ShareResult {
  const { client, companyName, summary: s } = opts
  const country = opts.country ?? 'IN'
  const to = pickRecipient(client, raw => waPhone(raw, country))
  const toParent = !!(to.toParent && to.phone)
  const greetName = firstName(toParent ? client.guardian_name : client.full_name)
  const toLabel = toParent
    ? (() => { const n = (client.guardian_name || '').trim(), r = (client.guardian_relation || '').trim(); return r && n ? `${r} (${n})` : r || n || 'Guardian' })()
    : client.full_name
  const monthName = formatDate(s.from, country, 'monthLong')
  const out: string[] = []

  out.push(greet(greetName, toParent
    ? `here's ${firstName(client.full_name)}'s ${monthName} at ${companyName}`
    : `here's your ${monthName} at ${companyName}`, country))
  out.push(monthRangeText(s, country))

  if (!s.sessions) {
    const emoji = opts.businessType === 'martial_arts' ? '🥋' : '💪'
    out.push('', `No sessions logged in ${monthName}${s.current ? ' yet' : ''}. Let's get back on track ${emoji}`)
  } else {
    out.push('', s.planned ? `✅ ${s.done} of ${s.planned} planned sessions done` : `✅ ${plural(s.sessions, 'session')} logged`)
    if (s.planned && s.sessions > s.done) out.push(`+${plural(s.sessions - s.done, 'extra session')}`)
    const lines = s.weeks.map(w => weekLine(w, country)).filter((l): l is string => !!l)
    if (lines.length > 1) out.push('', 'Week by week:', ...lines)
    const totals = [
      s.minutes ? `⏱ ${s.minutes.toLocaleString('en-US')} min` : '',
      plural(s.activeDays, 'active day'),
      s.kcal ? `🔥 about ${s.kcal.toLocaleString('en-US')} kcal (estimate)` : '',
    ].filter(Boolean)
    out.push('', totals.join(' · '))
    const gains = opts.gains ?? []
    if (gains.length) out.push(`💪 Stronger: ${gains.map(g => `${g.name} ${weightText(g.from)} → ${weightText(g.to)} kg`).join(', ')}`)
  }

  const note = (opts.note || '').trim()
  if (note) out.push('', note)
  out.push('', `— ${[firstName(opts.coachName), companyName].filter(Boolean).join(', ')}`)
  return { text: out.join('\n'), toPhone: to.phone, toLabel }
}

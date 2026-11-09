// Prints the owner "Today" schedule rules (lib/today-schedule.ts) for a few sample clients, and fails on a wrong result.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-today-schedule.ts --outDir /tmp/cts --module commonjs --target es2020 --skipLibCheck && node /tmp/cts/scripts/check-today-schedule.js

import { buildDaySchedule, forCoach, timeLabel, hourLabel, expiredOn, type ScheduleMembership } from '../lib/today-schedule'
import { timeMinutes, type CoachClient, type CoachPlan, type CoachSession } from '../lib/coach-today'

const today = '2026-10-29' // a Thursday
const weekStart = '2026-10-26' // Monday
let failures = 0
const check = (label: string, ok: boolean) => { console.log(`${ok ? '  ok ' : '  FAIL'} ${label}`); if (!ok) failures++ }

const staffNames = { ravi: 'Ravi Kumar', meena: 'Meena Iyer', owner: 'Anand Rao' }
const coachIds = new Set(['ravi', 'meena'])

const client = (id: string, primary: string | null, extra: Partial<CoachClient> = {}): CoachClient =>
  ({ id, full_name: id, primary_coach_id: primary, client_type: 'pt', archived_at: null, ...extra })
const plan = (client_id: string, workout_time: string | null, opts: { restThu?: boolean; text?: boolean } = {}): CoachPlan => ({
  id: `plan-${client_id}`, client_id, week_start: weekStart, workout_time,
  plan_details: opts.text ? 'Day 1: Legs\nDay 2: Upper body' : '',
  plan_json: opts.text ? null : {
    days: [
      { day: 'Mon', focus: 'Legs', rest: false, exercises: [{ name: 'Squat', sets: '3', reps: '10', rest: '', note: '' }] },
      { day: 'Thu', focus: opts.restThu ? '' : 'Upper Body Push', rest: !!opts.restThu, exercises: opts.restThu ? [] : [{ name: 'Bench', sets: '3', reps: '10', rest: '', note: '' }] },
    ],
  },
})
const session = (client_id: string, logged_by: string | null, created_at = '2026-10-29T10:00:00Z', session_date = today): CoachSession =>
  ({ id: `s-${client_id}-${created_at}`, client_id, session_date, duration_minutes: 45, weekly_plan_id: null, plan_day: null, logged_by, notes: null, created_at })

const clients = [
  client('Asha', 'ravi'),                 // 7:00, trained by Ravi
  client('Bharat', 'ravi'),               // 7:30, trained by Meena (covering)
  client('Chitra', 'meena'),              // 9:00, nothing logged, time passed
  client('Dev', 'meena'),                 // 18:00, not yet
  client('Esha', null),                   // workout today, no time
  client('Farid', 'ravi'),                // rest day, not shown
  client('Gita', 'ravi'),                 // no plan, trained by client → also trained
  client('Hari', null),                   // no plan, nothing → no time set (no plan)
  client('Indu', 'ravi', { archived_at: '2026-10-01' }), // archived: skipped
  client('Jai', 'ravi'),                  // membership expired: skipped
  client('Kiran', 'meena', { client_type: 'member' }),   // not PT: skipped
  client('Lata', 'meena'),                // Day 1/Day 2 text plan, "6 pm" free text
]
const plans = [
  plan('Asha', '07:00'), plan('Bharat', '7:30 am'), plan('Chitra', '09:00'), plan('Dev', '18:00'),
  plan('Esha', null), plan('Farid', '07:00', { restThu: true }), plan('Indu', '07:00'), plan('Jai', '07:00'),
  plan('Kiran', '07:00'), plan('Lata', '6 pm', { text: true }),
]
const sessions = [
  session('Asha', 'ravi'),
  session('Bharat', 'meena', '2026-10-29T03:00:00Z'), session('Bharat', 'ravi', '2026-10-29T02:00:00Z'), // newest = Meena
  session('Gita', 'Gita'),
]
const memberships: ScheduleMembership[] = [
  { profile_id: 'Jai', start_date: '2026-09-01', end_date: '2026-10-28' },
  { profile_id: 'Asha', start_date: '2026-08-01', end_date: '2026-09-01' },   // old one ended…
  { profile_id: 'Asha', start_date: '2026-09-01', end_date: '2026-12-01' },   // …but renewed
]

console.log('1. Today 29 Oct at 10:30 am')
const d = buildDaySchedule({ clients, plans, sessions, memberships, staffNames, coachIds, date: today, today, nowMinutes: 10 * 60 + 30 })
for (const r of [...d.slots, ...d.noTime, ...d.alsoTrained]) {
  console.log(`   ${r.client.full_name.padEnd(7)} ${(r.minutes != null ? timeLabel(r.minutes, 'IN') : '-').padEnd(8)} ${String(r.status).padEnd(10)} ${r.trainedBy ?? ''}${r.covering ? ' (covering)' : ''} ${r.reason ?? ''}`)
}
const st = (n: string) => [...d.slots, ...d.noTime, ...d.alsoTrained].find(r => r.client.full_name === n)
check('slots in time order', d.slots.map(r => r.client.full_name).join() === 'Asha,Bharat,Chitra,Dev,Lata')
check('Asha trained by Coach Ravi, not covering', st('Asha')?.status === 'trained' && st('Asha')?.trainedBy === 'Coach Ravi' && !st('Asha')?.covering)
check('Bharat: newest session wins, covered by Meena', st('Bharat')?.trainedBy === 'Coach Meena' && !!st('Bharat')?.covering)
check('Chitra 9:00, 10:30 now → not logged', st('Chitra')?.status === 'not-logged')
check('Dev 6 pm → expected', st('Dev')?.status === 'expected')
check('Lata text plan + "6 pm" → slot at 18:00, expected', st('Lata')?.minutes === 18 * 60 && st('Lata')?.status === 'expected')
check('Esha no time → no time set, expected', st('Esha')?.reason === 'no-time' && st('Esha')?.status === 'expected')
check('Hari no plan → no time set', st('Hari')?.reason === 'no-plan' && d.noTime.at(-1)?.client.full_name === 'Hari')
check('Gita trained without a plan → also trained, by client', d.alsoTrained.map(r => r.client.full_name).join() === 'Gita' && st('Gita')?.trainedBy === 'client')
check('Farid rest day, Indu archived, Jai expired, Kiran member → not shown', !st('Farid') && !st('Indu') && !st('Jai') && !st('Kiran'))
check('summary 6 expected / 3 trained / 1 not logged', d.summary.expected === 6 && d.summary.trained === 3 && d.summary.notLogged === 1)

console.log('2. Grace hour: Chitra at 9:59 still expected')
const early = buildDaySchedule({ clients, plans, sessions, memberships, staffNames, coachIds, date: today, today, nowMinutes: 9 * 60 + 59 })
check('9:59 → expected', early.slots.find(r => r.client.full_name === 'Chitra')?.status === 'expected')

console.log('3. Past and future days')
const past = buildDaySchedule({ clients, plans, sessions: [], memberships, staffNames, coachIds, date: today, today: '2026-10-30', nowMinutes: 0 })
check('past day: every expected client → not logged (incl. no time)', past.summary.notLogged === past.summary.expected && past.summary.expected === 6)
const future = buildDaySchedule({ clients, plans, sessions: [], memberships, staffNames, coachIds, date: today, today: '2026-10-28', nowMinutes: 23 * 60 })
check('future day: expected, nothing not logged', future.summary.notLogged === 0)
check('expired the day after 28 Oct only', expiredOn(memberships, '2026-10-28').size === 0 && expiredOn(memberships, '2026-10-29').has('Jai'))

console.log('4. Coach filter')
check('Meena: her clients + Bharat (she covered)', forCoach(d.slots, 'meena').map(r => r.client.full_name).join() === 'Bharat,Chitra,Dev,Lata')
check('No coach: Esha, Hari', forCoach(d.noTime, 'none').map(r => r.client.full_name).join() === 'Esha,Hari')

console.log('5. Labels')
check('timeLabel', timeLabel(18 * 60 + 30, 'IN') === '6:30 pm' && timeLabel(0, 'US') === '12 AM' && timeLabel(12 * 60, 'IN') === '12 pm')
check('hourLabel', hourLabel(7 * 60 + 30, 'IN') === '7 am')
check('timeMinutes reads "18:30", "6 pm", "7.15 am"', timeMinutes('18:30') === 1110 && timeMinutes('6 pm') === 1080 && timeMinutes('7.15 am') === 435)

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1) }
console.log('\nAll checks passed')

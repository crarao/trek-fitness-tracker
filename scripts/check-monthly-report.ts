// Checks the monthly progress report (lib/monthly-report.ts): month picker incl. the change of
// year, weeks that cross two months, the current month counted to today, overlapping plans and
// the WhatsApp message. No test framework needed:
//   npx tsc scripts/check-monthly-report.ts --outDir /tmp/cmr --module commonjs --target es2020 --skipLibCheck --esModuleInterop && node /tmp/cmr/scripts/check-monthly-report.js

import { monthBounds, shiftMonth, monthOptions, defaultMonth, countRange, summarizeMonth, monthlyTotals, buildMonthlyMessage, monthRangeText, strengthGains } from '../lib/monthly-report'
import { planToText, type PlanJson } from '../lib/plan-structure'
import type { DatedLog } from '../lib/exercise-logs'

let failed = 0
const check = (label: string, ok: boolean, got?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`)
  if (!ok) failed++
}

// ---- Months and the change of year ----
check('Dec 2026 bounds', JSON.stringify(monthBounds('2026-12')) === JSON.stringify({ from: '2026-12-01', to: '2026-12-31' }), monthBounds('2026-12'))
check('Feb 2028 (leap year) ends on the 29th', monthBounds('2028-02').to === '2028-02-29', monthBounds('2028-02'))
check('Feb 2027 ends on the 28th', monthBounds('2027-02').to === '2027-02-28')
check('Jan 2027 minus one = Dec 2026', shiftMonth('2027-01', -1) === '2026-12')
check('Dec 2026 plus one = Jan 2027', shiftMonth('2026-12', 1) === '2027-01')

const jan = monthOptions({ today: '2027-01-03', since: '2026-10-15T08:00:00Z', country: 'IN' })
check('Picker on 3 Jan 2027: Jan (so far), Dec, Nov, Oct', jan.map(o => o.month).join(',') === '2027-01,2026-12,2026-11,2026-10', jan.map(o => o.month))
check('Every label has its year', jan[0].label === 'Jan 2027 (so far)' && jan[1].label === 'Dec 2026', jan.map(o => o.label))
check('Only this month is current', jan.filter(o => o.current).length === 1 && jan[0].current)
check('1st–5th starts on last month (Dec 2026)', defaultMonth(jan, '2027-01-03') === '2026-12')
check('From the 6th starts on this month', defaultMonth(jan, '2027-01-06') === '2027-01')
const fresh = monthOptions({ today: '2026-11-02', since: '2026-11-01', country: 'IN' })
check('Joined this month: only this month, even on the 2nd', fresh.length === 1 && defaultMonth(fresh, '2026-11-02') === '2026-11')
const old = monthOptions({ today: '2026-11-14', since: '2024-01-01', country: 'IN' })
check('At most 12 months', old.length === 12 && old[11].month === '2025-12', old.map(o => o.month))
check('No join date: only this month', monthOptions({ today: '2026-11-14', since: null, country: 'IN' }).length === 1)

// ---- Counting ----
const day = (d: string, focus: string) => ({ day: d, rest: false, focus, exercises: [{ name: focus, sets: '3', reps: '10', rest: '', note: '' }] })
const rest = (d: string) => ({ day: d, rest: true, focus: '', exercises: [] })
const json = { version: 1, note: '', days: [day('Mon', 'Legs'), day('Tue', 'Push'), rest('Wed'), day('Thu', 'Core'), day('Fri', 'Pull'), rest('Sat'), rest('Sun')] } as PlanJson
const plan = (id: string, week_start: string, j: PlanJson = json) => ({ id, week_start, plan_details: planToText(j), plan_json: j })
const s = (session_date: string, plan_day: string | null, weekly_plan_id: string | null, duration_minutes = 60) =>
  ({ session_date, plan_day, weekly_plan_id, duration_minutes })

// p1 starts Wed 28 Oct: Thu 29 + Fri 30 Oct are October, Mon 2 + Tue 3 Nov are November
// p2 starts Mon 9 Nov: Mon 9, Tue 10, Thu 12, Fri 13
const plans = [plan('p1', '2026-10-28'), plan('p2', '2026-11-09')]
const sessions = [
  s('2026-10-29', 'Thu', 'p1'),          // October, done
  s('2026-11-02', 'Mon', 'p1'),          // November, done
  s('2026-11-03', null, null, 45),       // no plan link, on p1's Tue: counts (one per date)
  s('2026-11-09', 'Mon', 'p2'),
  s('2026-11-10', null, 'p2', 30),       // linked without a day: counts
  s('2026-11-14', 'Fri', 'p2', 50),      // Friday's workout done on Saturday: counts by plan_day
]
const oct = summarizeMonth({ plans, sessions, month: '2026-10', today: '2026-11-14' })
check('Oct: the week across months gives October only its own days (1 of 2)', oct.planned === 2 && oct.done === 1, oct)
check('Oct is a past month: counted to the 31st', !oct.current && oct.upTo === '2026-10-31')
const nov = summarizeMonth({ plans, sessions, month: '2026-11', today: '2026-11-14' })
check('Nov so far: 5 of 6 (Thu 12 missed)', nov.planned === 6 && nov.done === 5, { planned: nov.planned, done: nov.done })
check('Nov: 5 sessions, 245 min, 5 active days', nov.sessions === 5 && nov.minutes === 245 && nov.activeDays === 5, nov)
check('Nov weeks: 1 Nov (Sun), 2–8, 9–14', nov.weeks.map(w => `${w.from}/${w.to}`).join(' ') === '2026-11-01/2026-11-01 2026-11-02/2026-11-08 2026-11-09/2026-11-14', nov.weeks)
check('Weeks add up to the month', nov.weeks.reduce((n, w) => n + w.done, 0) === nov.done && nov.weeks.reduce((n, w) => n + w.planned, 0) === nov.planned)
const early = summarizeMonth({ plans, sessions, month: '2026-11', today: '2026-11-11' })
check('On 11 Nov the 12th and 13th are not planned yet (4 planned)', early.planned === 4 && early.done === 4, early)

// A new plan from Thu 12 Nov replaces p2 for the 12th and 13th
const p3json = { version: 1, note: '', days: [day('Mon', 'A'), rest('Tue'), rest('Wed'), day('Thu', 'B'), rest('Fri'), rest('Sat'), rest('Sun')] } as PlanJson
const overlap = countRange([...plans, plan('p3', '2026-11-12', p3json)], sessions, '2026-11-09', '2026-11-15')
check('Overlap: newer plan owns 12–15 (Mon 9, Tue 10 from p2 + Thu 12 from p3 = 3 planned)', overlap.planned === 3, overlap)

// "Day 1, Day 2" text plan: counted whole in the week it starts
const textPlan = { id: 't1', week_start: '2026-09-07', plan_details: 'Day 1 · Legs\n- Squat\n\nDay 2 · Push\n- Bench', plan_json: null }
const sep = summarizeMonth({ plans: [textPlan], sessions: [s('2026-09-08', null, 't1'), s('2026-09-09', null, 't1')], month: '2026-09', today: '2026-11-14' })
check('Undatable text plan counts in its month (2 of 2)', sep.planned === 2 && sep.done === 2, sep)
const sepMix = summarizeMonth({ plans: [textPlan], sessions: [s('2026-09-08', null, 't1'), s('2026-09-10', null, null)], month: '2026-09', today: '2026-11-14' })
check('Undatable plan: an unlinked session in its week counts once (2 of 2, not 3 capped)', sepMix.planned === 2 && sepMix.done === 2, sepMix)
const sepOne = summarizeMonth({ plans: [textPlan], sessions: [s('2026-09-10', null, null)], month: '2026-09', today: '2026-11-14' })
check('Undatable plan: one unlinked session = 1 of 2 (not counted twice)', sepOne.done === 1, sepOne)

// No plan at all: sessions only
const noPlan = summarizeMonth({ plans: [], sessions: [s('2026-08-03', null, null), s('2026-08-20', null, null)], month: '2026-08', today: '2026-11-14' })
check('No plan: 0 planned, 2 sessions', noPlan.planned === 0 && noPlan.sessions === 2)

// Monthly chart totals across the change of year
const totals = monthlyTotals([s('2026-12-30', null, null, 40), s('2027-01-02', null, null, 20)], '2027-01', 3)
check('Chart months Nov, Dec, Jan', totals.map(t => t.month).join(',') === '2026-11,2026-12,2027-01')
check('Dec 1 session / 40 min, Jan 1 / 20', totals[1].sessions === 1 && totals[1].minutes === 40 && totals[2].minutes === 20, totals)

// ---- Strength gains ----
const log = (session_date: string, exercise_name: string, weight: number): DatedLog => ({
  id: session_date + exercise_name, session_id: 'x', client_id: 'c', company_id: 'g', exercise_id: null, exercise_name,
  position: 0, sets: 3, reps: 10, weight, unit: 'kg', created_at: `${session_date}T10:00:00Z`, session_date,
} as unknown as DatedLog)
const logs = [log('2026-10-05', 'Squat', 60), log('2026-11-04', 'Squat', 70), log('2026-10-06', 'Bench Press', 40), log('2026-11-05', 'Bench Press', 40), log('2026-11-20', 'Deadlift', 100)]
const gains = strengthGains(logs, [], '2026-11', '2026-11-14')
check('Gains: only Squat went up (Bench same, Deadlift after today)', gains.length === 1 && gains[0].name === 'Squat' && gains[0].from === 60 && gains[0].to === 70, gains)

// ---- Text ----
check('Range text IN', monthRangeText({ from: '2026-11-01', upTo: '2026-11-30', current: false }, 'IN') === '1–30 Nov 2026', monthRangeText({ from: '2026-11-01', upTo: '2026-11-30', current: false }, 'IN'))
check('Range text so far', monthRangeText({ from: '2026-11-01', upTo: '2026-11-14', current: true }, 'IN') === '1–14 Nov 2026 (so far)')
check('Range text US', monthRangeText({ from: '2026-12-01', upTo: '2026-12-31', current: false }, 'US') === 'Dec 1–31, 2026', monthRangeText({ from: '2026-12-01', upTo: '2026-12-31', current: false }, 'US'))

const client = { full_name: 'Priya Sharma', phone: '+919876543210', weight_kg: null }
const msg = buildMonthlyMessage({ client, companyName: 'Fit Hub', coachName: 'Ravi Kumar', summary: nov, gains, country: 'IN', note: 'Great month!' })
console.log('\n--- message ---\n' + msg.text + '\n---------------')
check('Namaste greeting with the month', msg.text.startsWith('Namaste Priya 🙏\nHere\'s your November at Fit Hub'))
check('Month line', msg.text.includes('✅ 5 of 6 planned sessions done'))
check('Week lines (the empty 1 Nov week left out)', msg.text.includes('Week by week:\n2 Nov: 2 of 2\n9 Nov: 3 of 4') && !msg.text.includes('1 Nov:'))
check('Totals + strength', msg.text.includes('⏱ 245 min · 5 active days') && msg.text.includes('💪 Stronger: Squat 60 → 70 kg'))
check('Note and sign-off', msg.text.includes('Great month!') && msg.text.endsWith('— Ravi, Fit Hub'))
check('To the client', msg.toPhone === '919876543210' && msg.toLabel === 'Priya Sharma')

const child = { ...client, guardian_name: 'Meena Sharma', guardian_relation: 'Mother', guardian_phone: '+919812345678' }
const kid = buildMonthlyMessage({ client: child, companyName: 'Fit Hub', summary: oct, country: 'IN' })
check('Parent: greets the parent, names the child, goes to the parent', kid.text.startsWith('Namaste Meena 🙏\nHere\'s Priya\'s October at Fit Hub') && kid.toPhone === '919812345678' && kid.toLabel === 'Mother (Meena Sharma)', kid)
const empty = buildMonthlyMessage({ client, companyName: 'Fit Hub', summary: summarizeMonth({ plans: [], sessions: [], month: '2026-11', today: '2026-11-14' }), country: 'US' })
check('Nothing logged, US wording', empty.text.startsWith('Hi Priya, here\'s your November at Fit Hub') && empty.text.includes('No sessions logged in November yet.'), empty.text)

console.log(failed ? `\n${failed} FAILED` : '\nAll passed')
process.exit(failed ? 1 : 0)

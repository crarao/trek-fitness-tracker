// Checks that the progress report's numbers agree: the week card ("X of Y days"), the session
// list and the "Sessions per week" chart bar all come from one counting rule (29 Oct fix).
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-report-counts.ts --outDir /tmp/crc --module commonjs --target es2020 --skipLibCheck && node /tmp/crc/scripts/check-report-counts.js

import { summarizeWeek, buildProgressMessage, recentWeeksAdherence } from '../lib/progress-share'
import { weeklyTotals } from '../lib/weekly-totals'
import { withoutEarlyLinks, planAdherence, recentAdherence } from '../lib/adherence'
import { doneDayKeys } from '../lib/plan-summary'
import { planToText, type PlanJson } from '../lib/plan-structure'

const today = '2026-11-01' // Sunday: the whole week of 26 Oct has passed
const weekStart = '2026-10-26'

const day = (day: string, focus: string) => ({
  day, rest: false, focus, exercises: [{ name: focus, sets: '3', reps: '10', rest: '', note: '' }],
})
const rest = (day: string) => ({ day, rest: true, focus: '', exercises: [] })
const planJson = {
  version: 1, note: '',
  days: [day('Mon', 'Legs'), day('Tue', 'Push'), rest('Wed'), day('Thu', 'Core'), day('Fri', 'Pull'), rest('Sat'), rest('Sun')],
} as PlanJson
const plan = { id: 'p1', week_start: weekStart, plan_details: planToText(planJson), plan_json: planJson }
const s = (session_date: string, plan_day: string | null, duration_minutes: number | null, weekly_plan_id: string | null = 'p1') =>
  ({ session_date, plan_day, duration_minutes, weekly_plan_id })

const fourPlanned = [s('2026-10-26', 'Mon', 60), s('2026-10-27', 'Tue', 45), s('2026-10-29', 'Thu', 50), s('2026-10-30', 'Fri', 55)]

let failed = 0
const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failed++ }
const report = (title: string, sessions: ReturnType<typeof s>[]) => {
  const week = summarizeWeek({ plan, sessions, weekStart, today })
  const bar = weeklyTotals(sessions, weekStart, 8).find(w => w.start === weekStart)!
  const text = buildProgressMessage({ client: { full_name: 'Anand', phone: null }, companyName: 'New Trekking Company', plan, sessions, weekStart, today }).text
  console.log(`\n${title}\n  card: ${week.done} of ${week.planned} days · list: ${week.sessions.length} · chart bar: ${bar.sessions} · minutes: ${week.minutes} (chart ${bar.minutes}) · extra: ${week.extra}`)
  console.log(text.split('\n').map(l => '  | ' + l).join('\n'))
  return { week, bar, text }
}

{
  const { week, bar, text } = report('1. 4 planned days, 4 sessions', fourPlanned)
  check('card 4 of 4', week.done === 4 && week.planned === 4)
  check('chart 4, list 4', bar.sessions === 4 && week.sessions.length === 4)
  check('no "extra" line', !text.includes('extra session'))
}
{
  // The bug from the 26 Oct PDF: an unplanned session with no minutes was in the chart but not the list
  const { week, bar, text } = report('2. 4 planned days, 5 sessions (one unplanned, no minutes)', [...fourPlanned, s('2026-10-31', null, null, null)])
  check('card 4 of 4', week.done === 4 && week.planned === 4)
  check('chart 5, list 5', bar.sessions === 5 && week.sessions.length === 5)
  check('"+1 extra session" shown', text.includes('+1 extra session'))
  check('minutes agree with chart', week.minutes === bar.minutes)
}
{
  const { week, bar } = report('3. Same plan day logged twice', [...fourPlanned, s('2026-10-30', 'Fri', 20)])
  check('card stays 4 of 4, chart and list 5', week.done === 4 && bar.sessions === 5 && week.sessions.length === 5 && week.extra === 1)
}
{
  const sessions = [s('2026-11-01', null, 30, null), s('2026-11-02', null, 40, null)]
  const totals = weeklyTotals(sessions, '2026-11-02', 2)
  console.log('\n4. Sunday 1 Nov and Monday 2 Nov\n  ' + totals.map(t => `${t.start}: ${t.sessions} session(s), ${t.minutes} min`).join('\n  '))
  check('Sunday stays in week of 26 Oct', totals[0].start === '2026-10-26' && totals[0].sessions === 1 && totals[0].minutes === 30)
  check('Monday starts week of 2 Nov', totals[1].start === '2026-11-02' && totals[1].sessions === 1 && totals[1].minutes === 40)
  check('report week of 26 Oct lists the Sunday only', summarizeWeek({ plan: null, sessions, weekStart, today }).sessions.length === 1)
  // A timestamp-style date still lands on its own day
  check('"2026-11-01T23:30:00" stays on Sunday', weeklyTotals([s('2026-11-01T23:30:00', null, 10)], '2026-11-02', 2)[0].sessions === 1)
}
{
  const four = recentWeeksAdherence({ plans: [plan], sessions: fourPlanned, weekStart, today })
  console.log(`\n5. Last 4 weeks (only the 26 Oct plan): ${four?.done} of ${four?.planned}`)
  check('Last 4 weeks counts the week like the card', four?.done === 4 && four?.planned === 4)
}

{
  // 14 Nov: sessions logged without a plan link still count toward the plan's days (card and Last 4 weeks)
  const unlinked = [s('2026-10-26', null, 60, null), s('2026-10-27', null, 45, null), s('2026-10-29', null, 50, null)]
  const week = summarizeWeek({ plan, sessions: unlinked, weekStart, today })
  const four = recentWeeksAdherence({ plans: [plan], sessions: unlinked, weekStart, today })
  console.log(`\n6. 3 sessions with no plan link: card ${week.done} of ${week.planned}, last 4 weeks ${four?.done} of ${four?.planned}`)
  check('unlinked sessions count: 3 of 4', week.done === 3 && week.planned === 4 && week.extra === 0)
  check('Last 4 weeks counts them too', four?.done === 3 && four?.planned === 4)
  const twoSameDay = summarizeWeek({ plan, sessions: [s('2026-10-26', 'Mon', 60), s('2026-10-26', null, 20, null)], weekStart, today })
  check('linked + unlinked on the same date = 1 day', twoSameDay.done === 1 && twoSameDay.extra === 1)
}

{
  // 14 Nov (Amit G on dev / Vedansh Rao on prod): history logged later while the newest plan was
  // picked, so October sessions point at the 2 Nov plan. They count in the week they happened.
  const p26 = { ...plan, id: 'p26' }                          // 26 Oct plan (Mon / Tue / Thu / Fri)
  const p2 = { ...plan, id: 'p2', week_start: '2026-11-02' }  // 2 Nov plan, same days
  const early = [s('2026-10-26', 'Mon', 60, 'p2'), s('2026-10-27', 'Tue', 45, 'p2'), s('2026-10-29', 'Thu', 50, 'p2')]
  const late = s('2026-11-03', 'Fri', 40, 'p26')               // 26 Oct plan's Friday, logged late: stays with it
  const raw = [...early, late]
  const fixed = withoutEarlyLinks(raw, [p26, p2])
  console.log('\n7. Sessions dated before their plan started')
  check('before: the 2 Nov plan wrongly gets 3 of 4 from October', planAdherence(p2, raw)?.done === 3)
  check('after: the 2 Nov plan has 0 (nothing done in its week)', planAdherence(p2, fixed)?.done === 0)
  check('after: the 26 Oct plan gets the 3 October days + its late Friday = 4 of 4', planAdherence(p26, fixed)?.done === 4)
  check('done ticks on the 2 Nov plan card: none', doneDayKeys('p2', fixed).size === 0)
  check('late log keeps its plan link', fixed[3].weekly_plan_id === 'p26' && fixed[3] === late)
  check('saved rows are not changed (copies only)', raw[0].weekly_plan_id === 'p2')
  check('nothing to change = the same list back', withoutEarlyLinks(fourPlanned, [plan]) === fourPlanned)
  check('unknown plan: left as it is', withoutEarlyLinks(early, [p26])[0].weekly_plan_id === 'p2')
  const four = recentAdherence([p26, p2], fixed, 4)
  check('Last 4 weeks over both plans: 4 of 8, each day in its own week', four?.done === 4 && four?.planned === 8)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
if (failed) process.exit(1)

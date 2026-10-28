// Prints the WhatsApp progress messages for a few sample clients, to read the wording.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-progress-share.ts --outDir /tmp/cps --module commonjs --target es2020 --skipLibCheck && node /tmp/cps/scripts/check-progress-share.js

import { buildProgressMessage, buildSessionMessage, maskPhone } from '../lib/progress-share'
import { planToText, type PlanJson } from '../lib/plan-structure'

const today = '2026-10-31' // a Saturday: Mon 26 – Fri 30 Oct have passed
const weekStart = '2026-10-26'

const day = (day: string, focus: string, n: number) => ({
  day, rest: false, focus,
  exercises: Array.from({ length: n }, (_, i) => ({ name: `${focus} ${i + 1}`, sets: '3', reps: '10', rest: '', note: '' })),
})
const rest = (day: string) => ({ day, rest: true, focus: '', exercises: [] })
const planJson = {
  version: 1, note: '',
  days: [day('Mon', 'Lower Body', 6), day('Tue', 'Upper Body Push', 7), rest('Wed'), day('Thu', 'Core', 5),
    day('Fri', 'Upper Body Pull', 6), day('Sat', 'Conditioning', 4), rest('Sun')],
} as PlanJson
const plan = { id: 'p1', week_start: weekStart, plan_details: planToText(planJson), plan_json: planJson }
const s = (date: string, label: string | null, done: number | null, total: number | null, min: number) => ({
  session_date: date, duration_minutes: min, weekly_plan_id: 'p1', plan_day: label,
  exercises_done: total ? { done: Array(done ?? 0).fill('x'), total } : null,
})

const cases: [string, Parameters<typeof buildProgressMessage>[0]][] = [
  ['1. Adult, 4 of 5 done, a missed day and a note', {
    client: { full_name: 'Rohan Mehta', phone: '98765 43210', weight_kg: 78 },
    companyName: 'Iron Gym', businessType: 'gym', coachName: 'Priya Sharma', plan, weekStart, today,
    sessions: [s('2026-10-26', 'Mon · Lower Body', 6, 6, 60), s('2026-10-27', 'Tue · Upper Body Push', 6, 7, 60),
      s('2026-10-30', 'Fri · Upper Body Pull', 5, 6, 55), s('2026-10-31', 'Sat · Conditioning', 4, 4, 45)],
    note: 'Great push this week. Keep the squat depth we worked on.',
  }],
  ['2. Child with guardian (dojo)', {
    client: { full_name: 'Aarav Rao', phone: null, weight_kg: 32, guardian_name: 'Priya Rao', guardian_relation: 'Mother', guardian_phone: '+91 99887 76655' },
    companyName: 'Lotus Dojo', businessType: 'martial_arts', coachName: 'Kenji Sato', plan, weekStart, today,
    sessions: [s('2026-10-27', 'Tue · Upper Body Push', 5, 7, 45), s('2026-10-29', 'Thu · Core', 5, 5, 45)],
    note: '',
  }],
  ['3. Zero sessions', {
    client: { full_name: 'Meera Iyer', phone: '9123456789', weight_kg: 60 },
    companyName: 'Iron Gym', businessType: 'gym', coachName: 'Priya Sharma', plan, weekStart, today,
    sessions: [], note: '',
  }],
  ['4. Text-only plan (no plan_json)', {
    client: { full_name: 'Sam Carter', phone: '(415) 555-0134', weight_kg: null },
    companyName: 'Peak Fitness', businessType: 'gym', coachName: 'Alex', country: 'US', weekStart, today,
    plan: { id: 'p2', week_start: weekStart, plan_details: 'Monday – Legs\n- Squats – 3 x 10\nWednesday – Push\n- Bench – 3 x 8\nFriday – Pull\n- Rows – 3 x 10' },
    sessions: [{ session_date: '2026-10-26', duration_minutes: 50, weekly_plan_id: 'p2', plan_day: 'Mon · Legs' },
      { session_date: '2026-10-28', duration_minutes: 40, weekly_plan_id: null, activity: 'run' }],
    note: '',
  }],
  ['5. Same as the Progress tab: an extra session not saved against the plan, on a day already done', {
    client: { full_name: 'Anand Rao', phone: null, weight_kg: 76.5 },
    companyName: 'New Trekking Company', businessType: 'trek', coachName: 'Anand', plan, weekStart, today: '2026-10-28',
    sessions: [s('2026-10-26', 'Mon · Lower Body', 7, 7, 60),
      { session_date: '2026-10-27', duration_minutes: null, weekly_plan_id: null, plan_day: null },
      s('2026-10-27', 'Tue · Upper Body Push', 7, 7, 60)],
    note: '',
  }],
]

for (const [title, input] of cases) {
  const r = buildProgressMessage(input)
  console.log(`=== ${title}`)
  console.log(`To: ${r.toLabel} · ${maskPhone(r.toPhone, input.country ?? 'IN') || 'no phone'} (${r.text.length} chars)`)
  console.log(r.text + '\n')
}

const one = buildSessionMessage({
  client: { full_name: 'Rohan Mehta', phone: '9876543210' }, companyName: 'Iron Gym', coachName: 'Priya Sharma', today,
  session: s(today, 'Tue · Upper Body Push', 6, 7, 60),
})
console.log('=== 6. One session after Mark done')
console.log(one.text)

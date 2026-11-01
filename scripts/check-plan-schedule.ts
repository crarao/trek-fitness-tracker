// Checks the Available Days parsing and the "days a week" reading of the client's notes (generate-plan).
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-plan-schedule.ts --outDir /tmp/cps --module commonjs --target es2020 --skipLibCheck && node /tmp/cps/scripts/check-plan-schedule.js

import { parseAvailableDays, daysPerWeekMentioned, emptyPlan } from '../lib/plan-structure'

let failed = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`)
}

check('chips out of order', parseAvailableDays('Mon,Wed,Fri,Thu,Tue'), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
check('full names, spaces, case', parseAvailableDays(' monday, Tuesday ,SAT'), ['Mon', 'Tue', 'Sat'])
check('junk dropped', parseAvailableDays('Mon,,xyz,Sun'), ['Mon', 'Sun'])
check('empty', parseAvailableDays(null), [])
check('emptyPlan uses the same parsing', emptyPlan(' monday,Wed').days.filter(d => !d.rest).map(d => d.day), ['Mon', 'Wed'])

check('3 days a week', daysPerWeekMentioned('Lose weight, train 3 days a week'), 3)
check('four times per week', daysPerWeekMentioned('Can come four times per week'), 4)
check('3x/week', daysPerWeekMentioned('Strength 3x/week'), 3)
check('5 days per week', daysPerWeekMentioned('5 days per week, no machines'), 5)
check('5-day split', daysPerWeekMentioned('wants a 5-day split'), 5)
check('surgery 3 days ago (not a schedule)', daysPerWeekMentioned('knee surgery 3 days ago'), null)
check('rest 2 days (not a schedule)', daysPerWeekMentioned('rest 2 days after long runs'), null)
check('no text', daysPerWeekMentioned(undefined), null)

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)

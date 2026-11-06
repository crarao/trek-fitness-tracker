// Prints the weight / reps logging rules (lib/exercise-logs.ts), to read the results.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-exercise-logs.ts --outDir /tmp/cel --module commonjs --target es2020 --skipLibCheck && node /tmp/cel/scripts/check-exercise-logs.js

import { type Exercise } from '../lib/exercises'
import {
  type DatedLog, parseSets, parseReps, parseWeight, isTimedOrDistance, matchExercise, resolveExerciseId,
  lastLogFor, prefill, stepWeight, numberFromInput, rowsToSave, logDetail, logLine, monthlyProgress,
  changeThisMonth, changeText, lastMonths, topWeightSeries,
  weekOf, weeklyProgress, changeThisPeriod, lastWeeks, withWeightIn, strengthReport, changeSinceStart, fromFirstWeight,
} from '../lib/exercise-logs'
import { withoutCalories } from '../lib/progress-share'

const ID_SQUAT = '00000000-0000-0000-0000-000000000002'
const ID_LAT = '00000000-0000-0000-0000-000000000001'
const ID_GYM_ROW = '00000000-0000-0000-0000-000000000007'
const ID_OTHER_GYM = '00000000-0000-0000-0000-000000000099'

const ex = (id: string, name: string, aliases: string[] = [], company_id: string | null = null, is_archived = false): Exercise =>
  ({ id, company_id, name, aliases, muscle_group: null, equipment: null, is_archived })

const library: Exercise[] = [
  ex(ID_LAT, 'Lat Pulldown', ['lat pull down', 'pulldown']),
  ex(ID_SQUAT, 'Barbell Back Squat', ['squat', 'back squat']),
  ex('00000000-0000-0000-0000-000000000003', 'Goblet Squat', ['db squat']),
  ex(ID_GYM_ROW, 'TRX Row', [], 'gym-a'),
  ex('00000000-0000-0000-0000-000000000008', 'TRX Row', [], null, true), // starter copy, archived: gym's own wins
]

let fails = 0
const check = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  const ok = g === w
  if (!ok) fails++
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${g}${ok ? '' : `   (want: ${w})`}`)
}

console.log('— Reading plan text')
check('sets "3"', parseSets('3'), 3)
check('sets "3 sets"', parseSets('3 sets'), 3)
check('sets ""', parseSets(''), null)
check('sets "50"', parseSets('50'), null)
check('reps "10"', parseReps('10'), 10)
check('reps "8–12" (low end)', parseReps('8–12'), 8)
check('reps "12 each side"', parseReps('12 each side'), 12)
check('reps "30 s"', parseReps('30 s'), null)
check('reps "AMRAP"', parseReps('AMRAP'), null)
check('weight "20 kg"', parseWeight('20 kg'), 20)
check('weight "12.5kg"', parseWeight('12.5kg'), 12.5)
check('weight "12,5 kg"', parseWeight('12,5 kg'), 12.5)
check('weight "20"', parseWeight('20'), 20)
check('weight "2 x 10 kg"', parseWeight('2 x 10 kg'), 10)
check('weight "45 lb" → kg', parseWeight('45 lb'), 20.5)
check('weight "bodyweight"', parseWeight('bodyweight'), null)
check('weight "BW"', parseWeight('BW'), null)
check('weight "RPE 7"', parseWeight('RPE 7'), null)
check('weight "70%"', parseWeight('70%'), null)
check('weight "light"', parseWeight('light'), null)
check('weight ""', parseWeight(''), null)

console.log('— Timed / distance')
check('"30 s" timed', isTimedOrDistance({ sets: '3', reps: '30 s' }), true)
check('"1 km" distance', isTimedOrDistance({ sets: '', reps: '1 km' }), true)
check('"20 min" timed', isTimedOrDistance({ sets: '', reps: '20 min' }), true)
check('"400m" distance', isTimedOrDistance({ sets: '4', reps: '400m' }), true)
check('"10" reps', isTimedOrDistance({ sets: '3', reps: '10' }), false)
check('"8–12" reps', isTimedOrDistance({ sets: '3', reps: '8–12' }), false)

console.log('— Matching names to the library')
check('"Barbell Back Squat"', matchExercise('Barbell Back Squat', library)?.id, ID_SQUAT)
check('"back squat" (other name)', matchExercise('back squat', library)?.id, ID_SQUAT)
check('"Lat Pull-Down" (dash, case)', matchExercise('Lat Pull-Down', library)?.id, ID_LAT)
check('"TRX Row" → gym\'s own, not archived starter', matchExercise('TRX Row', library)?.id, ID_GYM_ROW)
check('"Squats" (no guessing)', matchExercise('Squats', library), null)
check('"" ', matchExercise('', library), null)
check('resolve: plan id in library', resolveExerciseId({ name: 'Whatever', exercise_id: ID_LAT }, library), ID_LAT)
check('resolve: plan id not in library → by name', resolveExerciseId({ name: 'squat', exercise_id: ID_OTHER_GYM }, library), ID_SQUAT)
check('resolve: AI name, no id', resolveExerciseId({ name: 'Goblet squat' }, library), '00000000-0000-0000-0000-000000000003')
check('resolve: unknown', resolveExerciseId({ name: 'Sled Push' }, library), null)

const log = (o: Partial<DatedLog> & { exercise_name: string; session_date: string }): DatedLog => ({
  id: Math.random().toString(36).slice(2), session_id: 's', exercise_id: null, position: 0,
  sets: 3, reps: 10, weight: 20, unit: 'kg', created_at: o.session_date + 'T10:00:00Z', ...o,
})
const logs: DatedLog[] = [
  log({ exercise_name: 'Barbell Back Squat', exercise_id: ID_SQUAT, session_date: '2026-10-02', weight: 40 }),
  log({ exercise_name: 'Barbell Back Squat', exercise_id: ID_SQUAT, session_date: '2026-10-20', weight: 45 }),
  log({ exercise_name: 'Back squat', session_date: '2026-11-03', weight: 50, reps: 8 }),   // saved without id
  log({ exercise_name: 'Sled Push', session_date: '2026-11-01', sets: 4, reps: null, weight: 60 }),
  log({ exercise_name: 'sled push', session_date: '2026-10-05', sets: 4, reps: null, weight: 50 }),
  log({ exercise_name: 'Plank', session_date: '2026-11-02', sets: 3, reps: null, weight: null }),
]

console.log('— Pre-fill from the last log')
check('by id (finds the id-less newer log too)', lastLogFor({ name: 'Barbell Back Squat', exercise_id: ID_SQUAT }, logs, library)?.weight, 50)
check('AI name "Squat" → alias of the library exercise', lastLogFor({ name: 'Squat' }, logs, library)?.weight, 50)
check('free-text name, different case', lastLogFor({ name: 'SLED PUSH' }, logs, library)?.weight, 60)
check('never logged', lastLogFor({ name: 'Lat Pulldown', exercise_id: ID_LAT }, logs, library), null)
const squatPlan = { name: 'Squat', sets: '4', reps: '6–8', rest: '90 s', note: '', weight: '30 kg' }
check('prefill from last log', prefill(squatPlan, { sets: 3, reps: 8, weight: 50 }), { sets: 3, reps: 8, weight: 50 })
check('prefill from plan text', prefill(squatPlan, null), { sets: 4, reps: 6, weight: 30 })
check('prefill timed: no reps / weight', prefill({ name: 'Plank', sets: '3', reps: '30 s', rest: '', note: '' }, null), { sets: 3, reps: null, weight: null })
check('prefill bodyweight', prefill({ name: 'Push-Up', sets: '3', reps: '12', rest: '', note: '', weight: 'bodyweight' }, null), { sets: 3, reps: 12, weight: null })

console.log('— −/+ on weight')
check('12 +', stepWeight(12, 1), 14.5)
check('12 −', stepWeight(12, -1), 9.5)
check('10 −', stepWeight(10, -1), 9)
check('9 +', stepWeight(9, 1), 10)
check('empty +', stepWeight(null, 1), 1)
check('1 − → empty', stepWeight(1, -1), null)
check('input "12,5"', numberFromInput('12,5', 'weight'), 12.5)
check('input "3.6" sets', numberFromInput('3.6', 'sets'), 4)
check('input "" ', numberFromInput('', 'reps'), null)
check('input "-5"', numberFromInput('-5', 'weight'), null)
check('input "999" reps → max 200', numberFromInput('999', 'reps'), 200)

console.log('— Rows to save')
const day = [
  { name: 'Squat', sets: '3', reps: '10', rest: '', note: '' },                              // 0: AI name → library id
  { name: 'Plank', sets: '3', reps: '30 s', rest: '', note: '' },                            // 1: timed → skipped
  { name: 'Sled Push', sets: '4', reps: '', rest: '', note: '' },                            // 2: not in library → no id
  { name: 'Lat Pulldown', sets: '3', reps: '12', rest: '', note: '', exercise_id: ID_LAT },  // 3: not ticked
  { name: 'Curl', sets: '3', reps: '10', rest: '', note: '' },                               // 4: ticked, all empty → skipped
]
const rows = rowsToSave({
  exercises: day, ticked: [4, 2, 1, 0], sessionId: 'sess', clientId: 'cli', companyId: 'gym-a', loggedBy: 'coach', library,
  drafts: { 0: { sets: 3, reps: 10, weight: 12 }, 1: { sets: 3, reps: null, weight: null }, 2: { sets: 4, reps: null, weight: 60 }, 4: { sets: null, reps: null, weight: null } },
})
check('rows (in plan order, timed and empty left out)', rows.map(r => [r.position, r.exercise_name, r.exercise_id, r.sets, r.reps, r.weight]),
  [[0, 'Squat', ID_SQUAT, 3, 10, 12], [2, 'Sled Push', null, 4, null, 60]])
check('row has session, client, gym, kg, logged_by', [rows[0].session_id, rows[0].client_id, rows[0].company_id, rows[0].unit, rows[0].logged_by], ['sess', 'cli', 'gym-a', 'kg', 'coach'])

console.log('— Showing')
check('"Squat 3×10 @ 12 kg"', logLine({ exercise_name: 'Squat', sets: 3, reps: 10, weight: 12 }), 'Squat 3×10 @ 12 kg')
check('no weight', logDetail({ sets: 3, reps: 10, weight: null }), '3×10')
check('sets + weight', logDetail({ sets: 4, reps: null, weight: 60 }), '4 sets @ 60 kg')
check('decimal', logDetail({ sets: 3, reps: 8, weight: 12.5 }), '3×8 @ 12.5 kg')
check('only weight', logDetail({ sets: null, reps: null, weight: 20 }), '@ 20 kg')

console.log('— Monthly progress')
const prog = monthlyProgress(logs, library)
check('exercises (most logs first; id and id-less squat grouped)', prog.map(p => [p.name, p.logs]), [['Back squat', 3], ['Sled Push', 2], ['Plank', 1]])
const squat = prog[0]
check('squat months', squat.points.map(m => [m.period, m.topWeight, m.volume]), [['2026-10', 45, 2550], ['2026-11', 50, 1200]])
check('squat change Nov', changeThisMonth(squat, '2026-11'), 11)
check('sled change Nov (no reps: no volume)', [changeThisMonth(prog[1], '2026-11'), prog[1].points.map(m => m.volume)], [20, [0, 0]])
check('plank: no weight → no change', changeThisMonth(prog[2], '2026-11'), null)
check('no log this month → no change', changeThisMonth(squat, '2026-12'), null)
check('first month only → no change', changeThisMonth(squat, '2026-10'), null)
check('change text', [changeText(11), changeText(-5), changeText(0)], ['+11%', '−5%', '0%'])
check('last 6 months over new year', lastMonths('2026-02', 6), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
check('series with gaps', topWeightSeries(squat, lastMonths('2026-11', 3)), [null, 45, 50])

console.log('— Weekly progress')
check('week of Sun 8 Nov = Mon 2 Nov', weekOf('2026-11-08'), '2026-11-02')
check('week of Mon 2 Nov', weekOf('2026-11-02'), '2026-11-02')
check('week across a month: Sun 1 Nov → Mon 26 Oct', weekOf('2026-11-01'), '2026-10-26')
check('last 3 weeks', lastWeeks('2026-11-05', 3), ['2026-10-19', '2026-10-26', '2026-11-02'])
const weekly = weeklyProgress(logs, library)
const wSquat = weekly.find(p => p.name === 'Back squat')!
check('squat by week', wSquat.points.map(p => [p.period, p.topWeight]), [['2026-09-28', 40], ['2026-10-19', 45], ['2026-11-02', 50]])
check('squat +% this week', changeThisPeriod(wSquat, '2026-11-02'), 11)
check('series by week with gaps', topWeightSeries(wSquat, lastWeeks('2026-11-05', 3)), [45, null, 50])
check('with weight in last 3 weeks (plank has none)', withWeightIn(weekly, lastWeeks('2026-11-05', 3)).map(p => p.name), ['Back squat', 'Sled Push'])

console.log('— PDF: Strength by exercise')
const rep = strengthReport(logs, library, '2026-11-08')!
check('table months', rep.months, ['2026-09', '2026-10', '2026-11'])
check('rows (plank left out: no weight)', rep.rows.map(r => [r.name, r.values, r.sinceStart, r.first]),
  [['Back squat', [null, 45, 50], 11, false], ['Sled Push', [null, 50, 60], 20, false]])
check('chart = most logged, from its first month', [rep.chart?.name, rep.chart?.months, rep.chart?.data], ['Back squat', ['2026-10', '2026-11'], [45, 50]])
check('both start in Oct: header since Oct', rep.since, '2026-10')
const firstOnly = strengthReport([log({ exercise_name: 'Goblet Squat', session_date: '2026-11-03', weight: 12 })], library, '2026-11-08')!
check('first month: New, no trend line', firstOnly.rows.map(r => [r.name, r.values, r.sinceStart, r.first, r.trend]), [['Goblet Squat', [null, null, 12], null, true, null]])
check('only New rows: no "Since" header', firstOnly.since, null)
check('one month only: no chart', firstOnly.chart, null)
check('logs after the report week are left out', strengthReport(logs, library, '2026-10-31')!.rows.map(r => [r.name, r.values, r.sinceStart]),
  [['Barbell Back Squat', [null, null, 45], null], ['sled push', [null, null, 50], null]])
check('nothing to show', strengthReport([], library, '2026-11-08'), null)
const down = strengthReport([
  log({ exercise_name: 'Squat', session_date: '2026-10-10', weight: 50 }),
  log({ exercise_name: 'Squat', session_date: '2026-11-03', weight: 45 }),
], library, '2026-11-08')!
check('down since start', down.rows[0].sinceStart, -10)
const octOnly = strengthReport([log({ exercise_name: 'Squat', session_date: '2026-10-10', weight: 50 })], library, '2026-11-08')!.rows[0]
check('one month with a weight (not this month): New, no change', [octOnly.first, octOnly.sinceStart, octOnly.start], [true, null, '2026-10'])

// Partial current month lighter than last month: compared with the first month, not last month
const curls = strengthReport([
  log({ exercise_name: 'Bicep Curl', session_date: '2026-09-05', weight: 5 }),
  log({ exercise_name: 'Bicep Curl', session_date: '2026-10-05', weight: 6 }),
  log({ exercise_name: 'Bicep Curl', session_date: '2026-10-20', weight: 7 }),
  log({ exercise_name: 'Bicep Curl', session_date: '2026-11-03', weight: 5.5 }),
], library, '2026-11-06')!
check('light partial month: % vs first month (5 → 5.5), not vs last month (7)', [curls.rows[0].sinceStart, curls.rows[0].first], [10, false])
check('light partial month: trend Sep → Nov', curls.rows[0].trend, [5, 7, 5.5])
const curlsNow = monthlyProgress([
  log({ exercise_name: 'Bicep Curl', session_date: '2026-09-05', weight: 5 }),
  log({ exercise_name: 'Bicep Curl', session_date: '2026-10-05', weight: 7 }),
  log({ exercise_name: 'Bicep Curl', session_date: '2026-11-03', weight: 5 }),
], library)[0]
check('Oct 7 → Nov 5: −29% vs last month (coach tab), 0% since Sep 5 (PDF)', [changeThisPeriod(curlsNow, '2026-11'), changeSinceStart(curlsNow, lastMonths('2026-11', 6))], [-29, 0])

// Gap months: break in the trend line; leading empty months trimmed
const gappy = strengthReport([
  log({ exercise_name: 'Leg Press', session_date: '2026-08-10', weight: 80 }),
  log({ exercise_name: 'Leg Press', session_date: '2026-08-20', weight: 80 }),
  log({ exercise_name: 'Leg Press', session_date: '2026-10-10', weight: 90 }),
  log({ exercise_name: 'Leg Press', session_date: '2026-11-03', weight: 100 }),
], library, '2026-11-06')!
check('gap month: trend has a gap', gappy.rows[0].trend, [80, null, 90, 100])
check('chart starts at the first month with a weight (Aug, not Jun)', [gappy.chart?.months, gappy.chart?.data], [['2026-08', '2026-09', '2026-10', '2026-11'], [80, null, 90, 100]])
check('since start Aug 80 → Nov 100', [gappy.rows[0].sinceStart, gappy.rows[0].start], [25, '2026-08'])
const legs = monthlyProgress([log({ exercise_name: 'Leg Press', session_date: '2026-09-10', weight: 80 })], library)[0]
check('trim leading empty months', fromFirstWeight(legs, lastMonths('2026-11', 6)), ['2026-09', '2026-10', '2026-11'])
const old = strengthReport([
  log({ exercise_name: 'Leg Press', session_date: '2026-03-10', weight: 60 }),
  log({ exercise_name: 'Leg Press', session_date: '2026-10-10', weight: 90 }),
  log({ exercise_name: 'Leg Press', session_date: '2026-11-03', weight: 100 }),
], library, '2026-11-06')!
check('weights older than 6 months not used', [old.rows[0].start, old.rows[0].sinceStart, old.chart?.months], ['2026-10', 11, ['2026-10', '2026-11']])

// Rows starting in different months: header "Progress" (since = null)
const mixed = strengthReport([
  log({ exercise_name: 'Leg Press', session_date: '2026-09-10', weight: 80 }),
  log({ exercise_name: 'Leg Press', session_date: '2026-11-03', weight: 100 }),
  log({ exercise_name: 'Bench Press', session_date: '2026-10-10', weight: 30 }),
  log({ exercise_name: 'Bench Press', session_date: '2026-11-04', weight: 35 }),
], library, '2026-11-06')!
check('mixed start months: header Progress', [mixed.since, mixed.rows.map(r => [r.name, r.start, r.sinceStart])],
  [null, [['Bench Press', '2026-10', 17], ['Leg Press', '2026-09', 25]]])

console.log('— PDF: no calories in the message')
check('after minutes', withoutCalories('Done 3 of 3\n\n⏱ 180 min · 🔥 about 1,234 kcal (estimate)\n\nGreat week'), 'Done 3 of 3\n\n⏱ 180 min\n\nGreat week')
check('on its own line', withoutCalories('Done\n\n🔥 about 900 kcal (estimate)\nNote'), 'Done\n\nNote')
check('no calories: unchanged', withoutCalories('Done\n\n⏱ 60 min'), 'Done\n\n⏱ 60 min')
check('coach\'s own words kept', withoutCalories('Burned lots of kcal today!'), 'Burned lots of kcal today!')

console.log(fails ? `\n${fails} FAILED` : '\nAll passed')
if (fails) process.exit(1)

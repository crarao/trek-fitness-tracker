// Prints the exercise library search and the plan_json weight / exercise_id handling, to read the results.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-exercises.ts --outDir /tmp/ce --module commonjs --target es2020 --skipLibCheck && node /tmp/ce/scripts/check-exercises.js

import { searchExercises, hasExactName, recentFromPlans, tidyName, type Exercise } from '../lib/exercises'
import { normalizePlan, planToText, exerciseDetail, parseExerciseLine, textToPlan } from '../lib/plan-structure'

const ex = (id: string, name: string, muscle_group: string, equipment: string, aliases: string[] = [], company_id: string | null = null): Exercise =>
  ({ id, company_id, name, aliases, muscle_group, equipment, is_archived: false })

const list: Exercise[] = [
  ex('00000000-0000-0000-0000-000000000001', 'Lat Pulldown', 'back', 'cable', ['lat pull down', 'pulldown']),
  ex('00000000-0000-0000-0000-000000000002', 'Barbell Back Squat', 'legs', 'barbell', ['squat', 'back squat']),
  ex('00000000-0000-0000-0000-000000000003', 'Goblet Squat', 'legs', 'dumbbell', ['db squat']),
  ex('00000000-0000-0000-0000-000000000004', 'Hindu Push-Up', 'chest', 'bodyweight', ['dand', 'dands']),
  ex('00000000-0000-0000-0000-000000000005', 'Push-Up', 'chest', 'bodyweight', ['pushup']),
  ex('00000000-0000-0000-0000-000000000006', 'Pec Deck', 'chest', 'machine', ['butterfly']),
  ex('00000000-0000-0000-0000-000000000007', 'TRX Row', 'back', 'other', [], 'gym-a'),
  { ...ex('00000000-0000-0000-0000-000000000008', 'Old Machine Row', 'back', 'machine', [], 'gym-a'), is_archived: true },
]
const names = (q: string, muscle: string | null = null, equipment: string | null = null, recent: string[] = []) =>
  searchExercises(list, { query: q, muscle, equipment }, recent).map(e => e.name).join(', ') || '(none)'

let fails = 0
const check = (label: string, got: string, want: string) => {
  const ok = got === want
  if (!ok) fails++
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}: ${got}${ok ? '' : `   (want: ${want})`}`)
}

console.log('1. Search (name + other names, archived hidden)')
check('"squat"', names('squat'), 'Barbell Back Squat, Goblet Squat')
check('"lat pull down"', names('lat pull down'), 'Lat Pulldown')
check('"pulldown"', names('pulldown'), 'Lat Pulldown')
check('"dand" (Indian name)', names('dand'), 'Hindu Push-Up')
check('"pushup" matches Push-Up first', names('pushup'), 'Push-Up, Hindu Push-Up')
check('"butterfly"', names('butterfly'), 'Pec Deck')
check('"row" hides archived', names('row'), 'TRX Row')
check('chest + machine chips', names('', 'chest', 'machine'), 'Pec Deck')
check('no search: recent first, then A–Z', names('', 'back', null, ['00000000-0000-0000-0000-000000000007']), 'TRX Row, Lat Pulldown')
check('recent by name (typed plans)', names('', 'legs', null, ['goblet squat']), 'Goblet Squat, Barbell Back Squat')

console.log('\n2. "+ Add as new" only when the name is new')
check('"lat pull-down" exists', String(hasExactName(list, 'lat pull-down')), 'true')
check('"Sled Push" is new', String(hasExactName(list, 'Sled Push')), 'false')
check('tidy "sled  push"', tidyName('  sled  push '), 'Sled Push')
check('tidy keeps "TRX Y-raise"', tidyName('TRX Y-raise'), 'TRX Y-raise')

console.log('\n3. plan_json keeps weight and exercise_id; old plans unchanged')
const plan = normalizePlan({
  days: [
    { day: 'Mon', focus: 'Push', exercises: [
      { name: 'Barbell Bench Press', sets: '4', reps: '8-10', weight: '40 kg', rest: '90 s', note: '', exercise_id: '00000000-0000-0000-0000-000000000009' },
      { name: 'Push-Up', sets: '3', reps: 'AMRAP', rest: '', note: 'slow', exercise_id: 'not-a-uuid' },
    ] },
  ],
})!
const mon = plan.days[0]
check('weight kept', mon.exercises[0].weight ?? '', '40 kg')
check('exercise_id kept', mon.exercises[0].exercise_id ?? '', '00000000-0000-0000-0000-000000000009')
check('bad exercise_id dropped', String('exercise_id' in mon.exercises[1]), 'false')
check('no weight key when empty', String('weight' in mon.exercises[1]), 'false')
check('detail with weight', exerciseDetail(mon.exercises[0]), '4 x 8-10 @ 40 kg, rest 90 s')
check('detail without weight (as before)', exerciseDetail(mon.exercises[1]), '3 x AMRAP')
check('text copy line', planToText(plan).split('\n')[1], '- Barbell Bench Press – 4 x 8-10 @ 40 kg, rest 90 s')
const parsed = parseExerciseLine('- Barbell Bench Press – 4 x 8-10 @ 40 kg, rest 90 s')
check('text → parts (weight)', `${parsed.name} | ${parsed.sets} | ${parsed.reps} | ${parsed.weight} | ${parsed.rest}`, 'Barbell Bench Press | 4 | 8-10 | 40 kg | 90 s')
const old = parseExerciseLine('- Squats – 3 x 10, rest 60s (slow)')
check('old text line unchanged', `${old.name} | ${old.sets} | ${old.reps} | ${old.rest} | ${old.note} | ${'weight' in old}`, 'Squats | 3 | 10 | 60s | slow | false')
check('round trip text → plan', textToPlan(planToText(plan))?.days[0].exercises[0].weight ?? '', '40 kg')

console.log('\n4. Recently used in the gym (newest plan first)')
check('ids, then names', recentFromPlans([{ plan_json: plan }, { plan_json: { days: [{ day: 'Tue', focus: 'Legs', exercises: [{ name: 'Goblet Squat' }] }] } }]).join(', '),
  '00000000-0000-0000-0000-000000000009, pushup, goblet squat')

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed')
if (fails) process.exit(1)

// Prints the exercise library search and the plan_json weight / exercise_id handling, to read the results.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-exercises.ts --outDir /tmp/ce --module commonjs --target es2020 --skipLibCheck && node /tmp/ce/scripts/check-exercises.js

import { searchExercises, hasExactName, recentFromPlans, tidyName, nameKey, findExercise, linkPlanExercises, shownForBusiness, type Exercise } from '../lib/exercises'
import { normalizePlan, planToText, exerciseDetail, parseExerciseLine, textToPlan, withSetTargets, withoutSetTargets, startSetTargets } from '../lib/plan-structure'

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

console.log('— name_key (same as the database) and findExercise (17 Nov)')
check('nameKey strips and lowercases', nameKey('Bar-Bell  Squat (DB)'), 'barbellsquatdb')
check('nameKey empty', nameKey('  -- '), '')
const lib2: Exercise[] = [
  ...list,
  ex('00000000-0000-0000-0000-000000000010', 'Barbell Squat', 'legs', 'barbell'),
  ex('00000000-0000-0000-0000-000000000011', 'Barbell Bench Press', 'chest', 'barbell', ['bench', 'flat bench']),
  ex('00000000-0000-0000-0000-000000000012', 'Romanian Deadlift', 'legs', 'barbell', ['rdl']),
]
const find = (q: string) => { const m = findExercise(q, lib2); return m ? `${m.kind}: ${m.exercise.name}` : '(none)' }
check('"Bar Bell Squat" = same key', find('Bar Bell Squat'), 'name: Barbell Squat')
check('"bench" via alias', find('bench'), 'alias: Barbell Bench Press')
check('"barbel squat" close', find('barbel squat'), 'close: Barbell Squat')
check('"Squat Barbell" reordered', find('Squat Barbell'), 'reordered: Barbell Squat')
check('"row" → TRX Row? no (short keys: exact only)', find('row'), '(none)')
check('"rdl" alias', find('rdl'), 'alias: Romanian Deadlift')
check('archived skipped', find('Old Machine Row'), '(none)')
check('unknown', find('Battle Ropes'), '(none)')

console.log('— AI plan save links exercise ids (17 Nov)')
const aiPlan = normalizePlan({ days: [{ day: 'Mon', focus: 'Legs', exercises: [
  { name: 'Bar Bell Squat', sets: '3', reps: '10' }, { name: 'Bench', sets: '3', reps: '8' },
  { name: 'Barbel Squat', sets: '3', reps: '8' }, { name: 'Battle Ropes', sets: '3', reps: '30 s' },
  { name: 'Push-Up', sets: '3', reps: '12', exercise_id: '00000000-0000-0000-0000-0000000000aa' },
] }] })!
const linked = linkPlanExercises(aiPlan, lib2).days.find(d => d.day === 'Mon')!.exercises.map(e => `${e.name}=${e.exercise_id ?? '-'}`)
check('same key / alias linked; typo and unknown left; existing id kept', linked.join(', '),
  'Bar Bell Squat=00000000-0000-0000-0000-000000000010, Bench=00000000-0000-0000-0000-000000000011, Barbel Squat=-, Battle Ropes=-, Push-Up=00000000-0000-0000-0000-0000000000aa')

console.log('— Plan: a weight / reps per set (17 Nov)')
const pyr = withSetTargets({ name: 'Squat', sets: '3', reps: '10', rest: '90 s', note: '', weight: '20 kg' },
  [{ kg: 20, reps: 10 }, { kg: 25, reps: 8 }, { kg: 30, reps: 6 }])
check('fields rewritten from the rows', JSON.stringify([pyr.sets, pyr.reps, pyr.weight]), '["3","10/8/6","20/25/30 kg"]')
check('detail lists the sets', exerciseDetail(pyr), '20 kg × 10 · 25 kg × 8 · 30 kg × 6, rest 90 s')
check('kept by normalizePlan', JSON.stringify(normalizePlan({ days: [{ day: 'Mon', focus: 'Legs', exercises: [pyr] }] })!.days[0].exercises[0].set_targets),
  '[{"kg":20,"reps":10},{"kg":25,"reps":8},{"kg":30,"reps":6}]')
const back = withoutSetTargets(pyr)
check('back to one target: the first set', JSON.stringify([back.sets, back.reps, back.weight, 'set_targets' in back]), '["3","10","20 kg",false]')
check('starting rows from the exercise', JSON.stringify(startSetTargets({ name: 'Row', sets: '4', reps: '8–12', rest: '', note: '', weight: '12.5 kg' })),
  '[{"kg":12.5,"reps":8},{"kg":12.5,"reps":8},{"kg":12.5,"reps":8},{"kg":12.5,"reps":8}]')
check('bodyweight: no kg', JSON.stringify(startSetTargets({ name: 'Push-Up', sets: '', reps: '12', rest: '', note: '', weight: 'bodyweight' })),
  '[{"kg":null,"reps":12},{"kg":null,"reps":12},{"kg":null,"reps":12}]')

// Yoga companies see only their own exercises and the starter list's Surya Namaskar
const st = (name: string, muscle_group: string, equipment = 'bodyweight') => ({ company_id: null, name, muscle_group, equipment })
const yogaShown = [st('Barbell Bench Press', 'chest', 'barbell'), st('Surya Namaskar', 'mobility'), st('Plank', 'core'),
  st('Crunches', 'core'), st('Shoulder Dislocates', 'mobility', 'band'), { company_id: 'g1', name: 'Tree Pose', muscle_group: 'legs', equipment: 'bodyweight' }]
check('yoga: starter gym moves hidden', yogaShown.filter(e => shownForBusiness(e, 'yoga')).map(e => e.name).join(', '), 'Surya Namaskar, Tree Pose')
check('gym: everything shown', String(yogaShown.filter(e => shownForBusiness(e, 'gym')).length), '6')
check('no business type: everything shown', String(yogaShown.filter(e => shownForBusiness(e, null)).length), '6')

console.log(fails ? `\n${fails} check(s) failed` : '\nAll checks passed')
if (fails) process.exit(1)

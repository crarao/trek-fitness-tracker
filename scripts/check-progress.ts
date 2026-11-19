// Checks the progress list rules (lib/progress.ts). Exits with 1 on a failed check.
//   npx tsc scripts/check-progress.ts --outDir /tmp/cpr --module commonjs --target es2020 --skipLibCheck && node /tmp/cpr/scripts/check-progress.js

import { type Exercise } from '../lib/exercises'
import { type PlanJson, emptyPlan } from '../lib/plan-structure'
import {
  type ProgressLog, progressRange, exerciseRows, progressSummary, bestSetText, changeAmountText, compactSets,
  chartAxis, daysBetween,
} from '../lib/progress'

let failed = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`)
}

const ROWS = '00000000-0000-0000-0000-0000000000a1'
const SQUAT = '00000000-0000-0000-0000-0000000000a2'
const PUSHUP = '00000000-0000-0000-0000-0000000000a3'
const CURL = '00000000-0000-0000-0000-0000000000a4'
const ex = (id: string, name: string, muscle: string | null, aliases: string[] = []): Exercise =>
  ({ id, company_id: null, name, aliases, muscle_group: muscle, equipment: null, is_archived: false })
const library = [
  ex(ROWS, 'Dumbbell Row', 'back', ['dumbbell rows', 'db row']),
  ex(SQUAT, 'Barbell Back Squat', 'legs', ['squat']),
  ex(PUSHUP, 'Push-up', 'chest'),
  ex(CURL, 'Dumbbell Curl', 'arms'),
]

let n = 0
const log = (date: string, name: string, sets: { kg: number | null; reps: number }[], id: string | null = null, by: string | null = null): ProgressLog => {
  n++
  const top = [...sets].sort((a, b) => (b.kg ?? 0) - (a.kg ?? 0))[0]
  return {
    id: `l${n}`, session_id: `s-${date}`, exercise_id: id, exercise_name: name, position: n, sets: sets.length,
    reps: top.reps, weight: top.kg, unit: 'kg', set_details: sets, created_at: `${date}T10:00:${String(n).padStart(2, '0')}Z`,
    session_date: date, logged_by: by,
  }
}
const s3 = (kg: number | null, reps: number) => [{ kg, reps }, { kg, reps }, { kg, reps }]

// Anand's screenshot: Dumbbell Rows 15 kg on 26 Oct, 3 × 10 @ 10 kg on 2 Nov; viewed on 19 Nov
const today = '2026-11-19'
const logs: ProgressLog[] = [
  log('2026-10-26', 'Dumbbell Rows', s3(15, 10)),
  log('2026-11-02', 'Dumbbell Rows', s3(10, 10), null, 'coach-1'),
  // Squat: before the range 60 kg; in range 50, 55, 62.5 → new best, not stalled
  log('2026-10-05', 'Squat', s3(60, 5), SQUAT),
  log('2026-10-27', 'Squat', s3(50, 5), SQUAT),
  log('2026-11-03', 'Squat', s3(55, 5), SQUAT),
  log('2026-11-17', 'Squat', s3(62.5, 5), SQUAT),
  // Curl: 3 times in range, same weight and volume → stalled
  log('2026-10-28', 'Dumbbell Curl', s3(8, 10), CURL),
  log('2026-11-04', 'Dumbbell Curl', s3(8, 10), CURL),
  log('2026-11-11', 'Dumbbell Curl', s3(8, 10), CURL),
  // Push-up: bodyweight, reps 10 → 14
  log('2026-10-29', 'Push ups', s3(null, 10), PUSHUP),
  log('2026-11-12', 'Push ups', [{ kg: null, reps: 14 }, { kg: null, reps: 12 }], PUSHUP),
]

const plan: PlanJson = emptyPlan()
plan.days[0] = { day: 'Mon', rest: false, focus: 'Pull', exercises: [
  { name: 'Dumbbell Row', sets: '3', reps: '10', rest: '', note: '', exercise_id: ROWS },
  { name: 'Lat Pulldown', sets: '3', reps: '10', rest: '', note: '' },
] }
plan.days[2] = { day: 'Wed', rest: false, focus: 'Legs', exercises: [
  { name: 'Barbell Back Squat', sets: '3', reps: '5', rest: '', note: '', exercise_id: SQUAT },
  { name: 'Plank', sets: '3', reps: '30 s', rest: '', note: '' },
] }

const range = progressRange(today, 'week')
eq('range: last 4 Monday weeks', range.periods, ['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'])
eq('range start', range.start, '2026-10-26')

const rows = exerciseRows({ logs, library, range, plan })
const row = (name: string) => rows.find(r => r.name === name)!

const dr = row('Dumbbell Row')
eq('typed "Dumbbell Rows" joins the library name by alias', !!dr, true)
eq('Dumbbell Rows: latest best set', bestSetText(dr.latest, dr.bodyweight), '10 kg × 10')
eq('Dumbbell Rows: change vs first in range', changeAmountText(dr.change, dr.bodyweight), '−5 kg')
eq('Dumbbell Rows: latest volume', dr.latest?.volume, 300)
eq('Dumbbell Rows: sparkline per week (gaps = null)', dr.series, [15, 10, null, null])
eq('Dumbbell Rows: last done 17 days ago → not done in 2+ weeks (in plan)', [dr.daysSince, dr.notDone], [17, true])
eq('Dumbbell Rows: logged by kept', dr.latest?.loggedBy, 'coach-1')

const sq = row('Barbell Back Squat')
eq('Squat: new best (62.5 beats 60 before the range)', sq.newBest, true)
eq('Squat: not stalled', sq.stalled, false)
eq('Squat: change +12.5 kg', changeAmountText(sq.change, false), '+12.5 kg')

eq('Curl: stalled', row('Dumbbell Curl').stalled, true)
eq('Curl: not a new best (nothing earlier)', row('Dumbbell Curl').newBest, false)

const pu = row('Push-up')
eq('Push-up: bodyweight', pu.bodyweight, true)
eq('Push-up: best reps', bestSetText(pu.latest, true), '14 reps')
eq('Push-up: change in reps', changeAmountText(pu.change, true), '+4 reps')

const lat = row('Lat Pulldown')
eq('Lat Pulldown: in plan, never done → row, not done', [lat.entries.length, lat.notDone, changeAmountText(lat.change, false)], [0, true, '—'])
eq('Plank (timed) is not listed', rows.some(r => r.name === 'Plank'), false)
eq('plan days per row', [dr.planDays, sq.planDays], [[0], [1]])

eq('sort: most recently done first, never done last', rows.map(r => r.name),
  ['Barbell Back Squat', 'Push-up', 'Dumbbell Curl', 'Dumbbell Row', 'Lat Pulldown'])
eq('summary', progressSummary(rows), { newBests: 1, stalled: 1, notDone: 2 })

eq('one session only → "—"', changeAmountText(exerciseRows({ logs: [logs[0]], library, range }).at(0)!.change, false), '—')

// Old single weight / reps rows (no set_details) still count, through setsOf()
const old: ProgressLog = { ...log('2026-11-10', 'Squat', s3(40, 8), SQUAT), set_details: null, sets: 3, reps: 8, weight: 40 }
eq('old row: 3 × 8 @ 40 kg', bestSetText(exerciseRows({ logs: [old], library, range })[0].latest, false), '40 kg × 8')

// Months
const mrange = progressRange(today, 'month')
eq('months range', [mrange.periods.length, mrange.start], [6, '2026-06-01'])
eq('Squat per month', exerciseRows({ logs, library, range: mrange }).find(r => r.name === 'Barbell Back Squat')!.series,
  [null, null, null, null, 60, 62.5])

eq('compact sets', compactSets([{ kg: 5, reps: 3 }, { kg: 7, reps: 4 }, { kg: 9, reps: 4 }]), '5×3 · 7×4 · 9×4')
eq('axis 10–15 kg starts at 0', chartAxis([15, 10, null]).min, 0)
const hi = chartAxis([100, 105])
eq('axis 100–105 kg: padded, at least ±20% of the max', hi.min <= 84 && hi.max >= 126, true)
eq('daysBetween', daysBetween('2026-11-02', '2026-11-19'), 17)

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')

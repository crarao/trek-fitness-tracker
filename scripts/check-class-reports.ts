// Prints the dojo class report rules (lib/class-reports.ts) for sample inputs. Fails (exit 1) on a wrong answer.
//   npx tsc scripts/check-class-reports.ts --outDir /tmp/ccr --module commonjs --target es2020 --skipLibCheck && node /tmp/ccr/scripts/check-class-reports.js

import { indexClasses, loggedDays, dayReport, studentDays, studentTotals, activityReport, readiness, beltOnDate, treeTotals, activityTree, syllabusFor, type BeltScope } from '../lib/class-reports'
import { absenteesFor } from '../lib/absences'
import type { AttendanceRow } from '../lib/attendance'
import type { DojoActivity } from '../lib/dojo-activities'
import type { BeltRank } from '../lib/belts'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(56)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

// Week of Mon 16 – Sun 22 Nov 2026; today = Thu 19
const today = '2026-11-19'
const B = (id: string, name: string, days: string[], start_time: string, branch_id = 'kok') => ({ id, name, days, start_time, end_time: null, branch_id, is_archived: false })
const juniors = B('j', 'Juniors', ['Mon', 'Wed', 'Fri'], '17:00:00')
const seniors = B('s', 'Seniors', ['Tue', 'Thu'], '19:00:00')
const batches = [juniors, seniors]
const A = (id: string, name: string, sort_order: number, is_archived = false): DojoActivity => ({ id, name, description: null, sort_order, is_default: false, is_archived })
const acts = [A('wu', 'Warm-up', 1), A('ka', 'Kata', 2), A('ku', 'Kumite', 3), A('old', 'Old drill', 4, true)]
const att = (profile_id: string, batch_id: string, class_date: string, present = true): AttendanceRow => ({ profile_id, batch_id, class_date, present, is_drop_in: false })

const classes = [
  { id: 'c1', batch_id: 'j', class_date: '2026-11-16', logged_at: 'x' },
  { id: 'c2', batch_id: 'j', class_date: '2026-11-18', logged_at: 'x' },
  { id: 'c3', batch_id: 's', class_date: '2026-11-17', logged_at: 'x' },
  { id: 'c4', batch_id: 's', class_date: '2026-11-19', logged_at: null },   // unlock-only row, nobody marked
]
const classActs = [
  { class_id: 'c1', activity_id: 'wu', activity_name: 'Warm-up', removed_at: null },
  { class_id: 'c1', activity_id: 'ka', activity_name: 'Kata', removed_at: null },
  { class_id: 'c2', activity_id: 'wu', activity_name: 'Warm-up', removed_at: null },
  { class_id: 'c2', activity_id: 'ku', activity_name: 'Kumite', removed_at: '2026-11-18T10:00:00Z' },   // unticked
  { class_id: 'c3', activity_id: 'ka', activity_name: 'Kata', removed_at: null },
  { class_id: 'c3', activity_id: 'old', activity_name: 'Old drill', removed_at: null },
]
const index = indexClasses(classes, classActs)
const attendance = [att('a', 'j', '2026-11-16'), att('a', 's', '2026-11-17'), att('b', 'j', '2026-11-16'), att('b', 'j', '2026-11-18', false), att('c', 'j', '2026-11-18')]
const logged = loggedDays(attendance, classes)

console.log('1. by day')
const mon = dayReport({ date: '2026-11-16', batches, attendance, index, holidays: [] })
check('Mon: Juniors, 2 present, its activities', mon.map(r => [r.batch.id, r.present, r.logged, r.activities]), [['j', 2, true, ['Warm-up', 'Kata']]])
const wed = dayReport({ date: '2026-11-18', batches, attendance, index, holidays: [] })
check('Wed: unticked activity left out, untapped not counted', wed.map(r => [r.present, r.activities]), [[1, ['Warm-up']]])
const thu = dayReport({ date: today, batches, attendance, index, holidays: [] })
check('Thu: Seniors not logged (unlock-only row)', thu.map(r => [r.batch.id, r.logged]), [['s', false]])
check('holiday named', dayReport({ date: today, batches, attendance, index, holidays: [{ id: 'h', branch_id: null, holiday_date: today, name: 'Diwali', removed_at: null }] })[0].holiday, 'Diwali')
check('extra class on a non-class day shows', dayReport({ date: '2026-11-17', batches, attendance: [...attendance, att('z', 'j', '2026-11-17')], index, holidays: [] })
  .map(r => [r.batch.id, r.extra]), [['j', true], ['s', false]])

console.log('\n2. by student')
const student = { id: 'b', full_name: 'B', batch_id: 'j', branch_id: 'kok', created_at: '2026-11-01T00:00:00Z' }
const days = studentDays({ student, homeBatch: juniors, from: '2026-11-16', to: '2026-11-22', today, attendance, logged, index, leaves: [], holidays: [] })
check('Mon came, Wed absent (untapped), off days, after today future', days.map(d => `${d.date.slice(8)}:${d.status}`),
  ['16:came', '17:off', '18:absent', '19:off', '20:future', '21:future', '22:future'])
check('activities on the day came', days[0].activities, ['Warm-up', 'Kata'])
const multi = studentDays({ student: { ...student, id: 'a' }, homeBatch: juniors, from: '2026-11-16', to: '2026-11-18', today, attendance, logged, index, leaves: [], holidays: [] })
check('drop-in elsewhere counts (Tue Seniors) with its activities', multi.map(d => [d.status, d.activities]), [['came', ['Warm-up', 'Kata']], ['came', ['Kata', 'Old drill']], ['absent', []]])
check('totals', studentTotals(multi), { came: 2, absent: 1, leave: 0, activities: [{ name: 'Kata', count: 2 }, { name: 'Old drill', count: 1 }, { name: 'Warm-up', count: 1 }] })
const leave = studentDays({ student, homeBatch: juniors, from: '2026-11-18', to: '2026-11-18', today, attendance, logged, index,
  leaves: [{ id: 'l', profile_id: 'b', from_date: '2026-11-17', to_date: '2026-11-19', note: null, cancelled_at: null }], holidays: [] })
check('on leave beats absent', leave[0].status, 'leave')
check('holiday beats absent', studentDays({ student, homeBatch: juniors, from: '2026-11-18', to: '2026-11-18', today, attendance, logged, index, leaves: [],
  holidays: [{ id: 'h', branch_id: 'kok', holiday_date: '2026-11-18', name: 'X', removed_at: null }] })[0].status, 'holiday')
check('before joining', studentDays({ student: { ...student, created_at: '2026-11-17' }, homeBatch: juniors, from: '2026-11-16', to: '2026-11-16', today,
  attendance: [], logged, index, leaves: [], holidays: [] })[0].status, 'before-join')
check('availability: Mon/Fri student not expected Wed', studentDays({ student: { ...student, available_days: 'Mon,Fri' }, homeBatch: juniors,
  from: '2026-11-18', to: '2026-11-18', today, attendance, logged, index, leaves: [], holidays: [] })[0].status, 'off')
check('not logged yet', studentDays({ student: { ...student, id: 'q', batch_id: 's' }, homeBatch: seniors, from: today, to: today, today,
  attendance, logged, index, leaves: [], holidays: [] })[0].status, 'not-logged')
// Same answer as the absentee list for the same day
const listWed = absenteesFor({ date: '2026-11-18', students: [student, { ...student, id: 'c', full_name: 'C' }], batches, attendance,
  classes, leaves: [], holidays: [] }).groups.flatMap(g => g.students.map(s => s.id))
check('agrees with the absentee list (Wed)', listWed, ['b'])

console.log('\n3. by activity')
const rep = activityReport({ activities: acts, batches, index, from: '2026-11-16', to: '2026-11-22' })
check('totals per activity', rep.map(r => [r.activity.name, r.total, r.last]), [['Warm-up', 2, '2026-11-18'], ['Kata', 2, '2026-11-17'], ['Kumite', 0, null], ['Old drill', 1, '2026-11-17']])
check('per batch', rep[1].batches.map(b => [b.batch.id, b.count, b.last]), [['j', 1, '2026-11-16'], ['s', 1, '2026-11-17']])
check('archived and never done: left out', activityReport({ activities: acts, batches, index, from: '2026-11-18', to: '2026-11-18' }).map(r => r.activity.name), ['Warm-up', 'Kata', 'Kumite'])

console.log('\n4. grading readiness')
const ranks: BeltRank[] = [
  { id: 'w', rank_order: 1, belt_name: 'White', kyu: null, color_hex: '#fff', is_active: true, min_months_from_previous: 0 },
  { id: 'y', rank_order: 2, belt_name: 'Yellow', kyu: 8, color_hex: '#ff0', is_active: true, min_months_from_previous: 3 },
]
const rd = readiness({ students: [
  { id: 'a', full_name: 'Aarav', current_rank_id: 'w', rank_achieved_on: '2026-08-01' },
  { id: 'b', full_name: 'Bina', current_rank_id: 'w', rank_achieved_on: '2026-11-17' },
  { id: 'n', full_name: 'No belt' },
], ranks, attendance, index, asOf: today })
check('eligible first, no-belt left out', rd.map(r => [r.student.id, r.eligibility.kind]), [['a', 'eligible'], ['b', 'not-yet']])
check('activity counts since the belt date', rd[0].activities, { wu: 1, ka: 2, old: 1 })
check('classes since', rd.map(r => r.classes), [2, 0])

console.log('\n5. items by belt')
// Kata practice with two items: Heian Nidan (Yellow+) and Bassai Dai (Brown+)
const tActs: DojoActivity[] = [A('ka', 'Kata', 2), A('wu', 'Warm-up', 1),
  { ...A('hn', 'Heian Nidan', 1), parent_id: 'ka', min_rank_id: 'y' }, { ...A('bd', 'Bassai Dai', 2), parent_id: 'ka', min_rank_id: 'br' }]
const tRanks = [{ id: 'w', rank_order: 1 }, { id: 'y', rank_order: 2 }, { id: 'br', rank_order: 7 }]
const tClasses = [{ id: 't1', batch_id: 'j', class_date: '2026-11-16', logged_at: 'x' }, { id: 't2', batch_id: 'j', class_date: '2026-11-18', logged_at: 'x' }]
const tIndex = indexClasses(tClasses, [
  { class_id: 't1', activity_id: 'wu', activity_name: 'Warm-up', removed_at: null },
  { class_id: 't1', activity_id: 'hn', activity_name: 'Heian Nidan', removed_at: null },
  { class_id: 't1', activity_id: 'bd', activity_name: 'Bassai Dai', removed_at: null },
  { class_id: 't2', activity_id: 'ka', activity_name: 'Kata', removed_at: null },
])
const tAtt = [att('kid', 'j', '2026-11-16'), att('kid', 'j', '2026-11-18'), att('sen', 'j', '2026-11-16')]
// The kid was White until 17 Nov, Yellow from then; the senior is Brown
const history = [
  { student_id: 'kid', rank_id: 'w', achieved_on: '2026-09-01', created_at: '2026-09-01T00:00:00Z' },
  { student_id: 'kid', rank_id: 'y', achieved_on: '2026-11-17', created_at: '2026-11-17T00:00:00Z' },
  { student_id: 'kid', rank_id: 'br', achieved_on: '2026-11-10', created_at: '2026-11-10T00:00:00Z', voided_at: 'x' },
]
check('belt on the day: before the grading', beltOnDate(history, 'kid', '2026-11-16', 'y'), 'w')
check('belt on the day: after the grading', beltOnDate(history, 'kid', '2026-11-18', 'y'), 'y')
check('undone (voided) change ignored', beltOnDate(history, 'kid', '2026-11-12', 'y'), 'w')
check('before the first record: earliest belt', beltOnDate(history, 'kid', '2026-01-01', 'y'), 'w')
check('no history: current belt', beltOnDate(history, 'sen', '2026-11-16', 'br'), 'br')
const scope: BeltScope = { activities: tActs, ranks: tRanks, rankOn: (id, d) => beltOnDate(history, id, d, id === 'sen' ? 'br' : 'y') }
const kidDays = studentDays({ student: { id: 'kid', full_name: 'Kid', batch_id: 'j' }, homeBatch: juniors, from: '2026-11-16', to: '2026-11-18', today,
  attendance: tAtt, logged: loggedDays(tAtt, tClasses), index: tIndex, leaves: [], holidays: [], scope })
check('White kid on 16 Nov: warm-up only (Heian Nidan is Yellow+)', kidDays[0].activities, ['Warm-up'])
check('Yellow kid on 18 Nov: the category ticked for everyone', kidDays[2].activities, ['Kata'])
const senDays = studentDays({ student: { id: 'sen', full_name: 'Sen', batch_id: 'j' }, homeBatch: juniors, from: '2026-11-16', to: '2026-11-16', today,
  attendance: tAtt, logged: loggedDays(tAtt, tClasses), index: tIndex, leaves: [], holidays: [], scope })
check('Brown senior: both katas', senDays[0].activities, ['Warm-up', 'Heian Nidan', 'Bassai Dai'])
check('without a scope everything counts (as before)', studentDays({ student: { id: 'kid', full_name: 'Kid', batch_id: 'j' }, homeBatch: juniors, from: '2026-11-16', to: '2026-11-16', today,
  attendance: tAtt, logged: loggedDays(tAtt, tClasses), index: tIndex, leaves: [], holidays: [] })[0].activities.length, 3)
check('tree totals roll items into the category', treeTotals(senDays, tActs), [
  { id: 'wu', name: 'Warm-up', count: 1, items: [] },
  { id: 'ka', name: 'Kata', count: 1, items: [{ id: 'hn', name: 'Heian Nidan', count: 1 }, { id: 'bd', name: 'Bassai Dai', count: 1 }] }])
check('kid: Kata counted on 18 Nov only', treeTotals(kidDays, tActs).map(t => [t.name, t.count, t.items.length]), [['Warm-up', 1, 0], ['Kata', 1, 0]])
const at = activityTree({ activities: tActs, batches, index: tIndex, from: '2026-11-16', to: '2026-11-22' })
check('activity tree: category rolled up, items under it', at.map(r => [r.activity.name, r.total, r.items.map(i => `${i.activity.name}:${i.total}`)]),
  [['Warm-up', 1, []], ['Kata', 2, ['Heian Nidan:1', 'Bassai Dai:1']]])
check("syllabus = items first taught at the student's belt", syllabusFor(tActs, 'y').map(a => a.name), ['Heian Nidan'])
const rdy = readiness({ students: [{ id: 'kid', full_name: 'Kid', current_rank_id: 'y', rank_achieved_on: '2026-11-01' }], ranks: [], attendance: tAtt, index: tIndex, asOf: today, scope })
check('readiness counts only what applied on each day', rdy[0].activities, { wu: 1, ka: 1 })

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

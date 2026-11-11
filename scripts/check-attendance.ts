// Prints the attendance rules (lib/attendance.ts) for sample inputs. Fails (exit 1) on a wrong answer.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-attendance.ts --outDir /tmp/ca --module commonjs --target es2020 --skipLibCheck && node /tmp/ca/scripts/check-attendance.js

import { weekdayOf, batchesOn, scheduledDates, roster, tapRow, monthStats, statsText, buildAttendanceMessage, cameElsewhere, elsewhereText, dayBoard, type AttendanceRow } from '../lib/attendance'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

const today = '2026-11-12' // a Thursday
const juniors = { id: 'j', name: 'Juniors', days: ['Mon', 'Wed', 'Fri'], start_time: '18:00:00', end_time: '19:00:00', is_archived: false }
const seniors = { id: 's', name: 'Seniors', days: ['Tue', 'Thu'], start_time: '19:00:00', end_time: '20:00:00', is_archived: false }
const kids = { id: 'k', name: 'Kids', days: ['Thu'], start_time: '17:00:00', end_time: null, is_archived: false }
const old = { id: 'o', name: 'Old', days: ['Thu'], start_time: '06:00:00', end_time: null, is_archived: true }

console.log('1. weekdays and today\'s batches')
check('weekdayOf 12 Nov 2026', weekdayOf(today), 'Thu')
check('weekdayOf 2 Nov 2026', weekdayOf('2026-11-02'), 'Mon')
check('batches on Thursday (archived left out)', batchesOn([juniors, seniors, kids, old], today).map(b => b.name), ['Kids', 'Seniors'])
check('batches on Sunday', batchesOn([juniors, seniors], '2026-11-15').map(b => b.name), [])

console.log('\n2. scheduledDates')
check('Juniors, 1–12 Nov', scheduledDates(juniors.days, '2026-11-01', today), ['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09', '2026-11-11'])
check('no days', scheduledDates([], '2026-11-01', today), [])

console.log('\n3. roster + tapRow')
const students = [
  { id: 'a', full_name: 'Ishan Rao', batch_id: 'j' },
  { id: 'b', full_name: 'Aarav Reddy', batch_id: 'j' },
  { id: 'c', full_name: 'Diya Shah', batch_id: 's' },
  { id: 'd', full_name: 'Old Student', batch_id: 'j', archived_at: '2026-10-01' },
]
const r = (profile_id: string, batch_id: string, class_date: string, present = true, is_drop_in = false): AttendanceRow =>
  ({ profile_id, batch_id, class_date, present, is_drop_in })
const rows = [r('a', 'j', '2026-11-11'), r('b', 'j', '2026-11-11', false), r('c', 'j', '2026-11-11', true, true), r('a', 'j', '2026-11-09')]
const ro = roster({ batchId: 'j', date: '2026-11-11', students, rows })
check('home list (archived left out, by name)', ro.home.map(h => `${h.student.full_name}:${h.present}`), ['Aarav Reddy:false', 'Ishan Rao:true'])
check('drop-ins who came', ro.dropIns.map(s => s.full_name), ['Diya Shah'])
check('came (home + drop-ins)', ro.came, 2)
const t1 = tapRow({ batchId: 'j', date: today, student: students[2], companyId: 'co', current: false, markedBy: 'sensei' })
check('tap a drop-in', [t1.present, t1.is_drop_in], [true, true])
const t2 = tapRow({ batchId: 'j', date: today, student: students[0], companyId: 'co', current: true, markedBy: 'sensei' })
check('untap home student (never deleted)', [t2.present, t2.is_drop_in], [false, false])

console.log('\n4. monthStats')
const ishanRows = [r('a', 'j', '2026-11-02'), r('a', 'j', '2026-11-04'), r('a', 's', '2026-11-05', true, true), r('a', 'j', '2026-11-05'), r('a', 'j', '2026-11-09', false), r('a', 'j', '2026-10-30')]
const ms = monthStats({ profileId: 'a', homeBatch: juniors, rows: ishanRows, month: today, today })
check('Nov so far: attended (one per day) of scheduled', [ms.attended, ms.scheduled], [3, 5])
check('statsText', statsText(ms), '3 of 5 classes')
check('no home batch', statsText(monthStats({ profileId: 'a', homeBatch: null, rows: ishanRows, month: today, today })), '3 classes')
check('past month counts to its end', monthStats({ profileId: 'a', homeBatch: juniors, rows: ishanRows, month: '2026-10-15', today }).scheduled, 13)
check('joined 1 Nov: October not counted as missed', monthStats({ profileId: 'a', homeBatch: juniors, rows: ishanRows.filter(x => x.class_date >= '2026-11-01'), month: '2026-10-15', today, since: '2026-11-01T09:00:00Z' }).scheduled, 0)
check('joined 1 Nov, came 30 Oct: 1 of 1', statsText(monthStats({ profileId: 'a', homeBatch: juniors, rows: ishanRows, month: '2026-10-15', today, since: '2026-11-01T09:00:00Z' })), '1 of 1 class')
check('joined 5 Nov: classes from then', monthStats({ profileId: 'a', homeBatch: juniors, rows: ishanRows.filter(x => x.class_date >= '2026-11-05'), month: today, today, since: '2026-11-05' }).scheduled, 3)
check('joined 5 Nov, came 2 Nov: from first class', monthStats({ profileId: 'a', homeBatch: juniors, rows: ishanRows, month: today, today, since: '2026-11-05' }).scheduled, 5)
const weekdays = { ...juniors, days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] }
const mani = monthStats({ profileId: 'a', homeBatch: weekdays, rows: [r('a', 'j', '2026-11-02'), r('a', 'j', '2026-11-03'), r('a', 'j', '2026-11-04')], month: '2026-11-04', today: '2026-11-04', since: '2026-11-04T07:00:00Z' })
check('added 4 Nov, marked 2–4 Nov: never "3 of 1"', statsText(mani), '3 of 3 classes')
check('more than scheduled: just the count', statsText({ attended: 4, scheduled: 3 }), '4 classes')

console.log('\n5. buildAttendanceMessage')
const withParent = buildAttendanceMessage({
  client: { full_name: 'Ishan Rao', phone: null, guardian_name: 'Anu Rao', guardian_relation: 'Mother', guardian_phone: '+919876543210' },
  companyName: 'Demo Dojo', staffName: 'Ravi Kumar', rows: ishanRows, homeBatch: juniors, today, country: 'IN',
})
console.log(withParent.text.split('\n').map(l => '      ' + l).join('\n'))
check('to the parent', [withParent.toPhone, withParent.toLabel], ['919876543210', 'Mother (Anu Rao)'])
check('greets the parent, counts', [withParent.text.startsWith("Namaste Anu 🙏\nHere's Ishan's attendance at Demo Dojo"), withParent.text.includes('✅ 3 of 5 classes attended')], [true, true])
const noParent = buildAttendanceMessage({
  client: { full_name: 'Sam Carter', phone: '+14155550134' }, companyName: 'Peak Dojo', rows: [], homeBatch: seniors, today, country: 'US',
})
console.log(noParent.text.split('\n').map(l => '      ' + l).join('\n'))
const lastMonthMsg = buildAttendanceMessage({ client: { full_name: 'Sam Carter', phone: '+14155550134' }, companyName: 'Peak Dojo', rows: [], homeBatch: seniors, today, month: '2026-10-10', country: 'US' })
check('past month, none: says the month', lastMonthMsg.text.includes('No classes attended in October.'), true)
check('no parent → student, none yet', [noParent.toPhone, noParent.text.includes('We hope to see you soon!')], ['14155550134', true])

console.log('\n6. the whole day: came elsewhere + dayBoard')
// Thursday: Kids (17:00) and Seniors (19:00) meet. Diya (home Seniors) came to Kids too; Ishan (home Juniors) dropped in to Seniors
const dayRows: AttendanceRow[] = [
  { ...r('c', 'k', today, true, true), marked_by: 'ravi' },
  { ...r('c', 's', today), marked_by: 'anu' },
  r('a', 's', today, true, true),
  r('b', 's', today, false),
  r('c', 'j', '2026-11-11'),
]
check('Diya came elsewhere (seen from Seniors)', cameElsewhere(dayRows, 'c', 's', today).map(x => x.batch_id), ['k'])
check('untapped / other days not counted', cameElsewhere(dayRows, 'b', 'k', today), [])
check('warning text', elsewhereText(cameElsewhere(dayRows, 'c', 's', today), id => id === 'k' ? 'Kids 5 PM' : id, id => id === 'ravi' ? 'Sensei Ravi' : ''), 'Kids 5 PM · by Sensei Ravi')
check('warning text, marker unknown', elsewhereText(cameElsewhere(dayRows, 'c', 'k', today), () => 'Seniors 7 PM', () => ''), 'Seniors 7 PM')
const board = dayBoard({ date: today, batches: [juniors, seniors, kids, old], students, rows: dayRows })
check('groups: today\'s batches by time', board.groups.map(g => g.batch.name), ['Kids', 'Seniors'])
check('Seniors: home + drop-in', board.groups[1].entries.map(e => `${e.student.full_name}:${e.present}:${e.dropIn}`), ['Diya Shah:true:false', 'Ishan Rao:true:true'])
check('Diya in Seniors warns about Kids', board.groups[1].entries[0].elsewhere.map(x => x.batch_id), ['k'])
check('marked by kept', board.groups[1].entries[0].markedBy, 'anu')
check('came counts each student once', [board.came, board.twice], [2, 1])
const extra = dayBoard({ date: today, batches: [juniors, seniors], students, rows: [r('a', 'j', today)] })
check('extra class on a non-class day shows', extra.groups.map(g => `${g.batch.name}:${g.extra}`), ['Juniors:true', 'Seniors:false'])

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

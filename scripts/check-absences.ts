// Prints the dojo absentee + absence message rules (lib/absences.ts) for sample inputs. Fails (exit 1) on a wrong answer.
//   npx tsc scripts/check-absences.ts --outDir /tmp/cabs --module commonjs --target es2020 --skipLibCheck && node /tmp/cabs/scripts/check-absences.js

import {
  type AbsenceStudent, absenteesFor, fillTemplate, unknownPlaceholders, templateProblem, absenceMessage, DEFAULT_ABSENCE_BODY,
  startRun, advance, runDone, runCurrent, runProgress, runSummary,
} from '../lib/absences'
import type { AttendanceRow } from '../lib/attendance'
import type { StudentLeave } from '../lib/leave'
import type { Holiday } from '../lib/holidays'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(56)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

const today = '2026-11-19' // a Thursday
const B = (id: string, name: string, days: string[], start_time: string, branch_id = 'kok') =>
  ({ id, name, days, start_time, end_time: null, branch_id, is_archived: false })
const juniors = B('j', 'Juniors', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], '17:00:00')
const seniors = B('s', 'Seniors', ['Tue', 'Thu'], '19:00:00')
const kids = B('k', 'Kids', ['Thu'], '16:00:00', 'gach')
const weekend = B('w', 'Weekend', ['Sat', 'Sun'], '09:00:00')
const batches = [juniors, seniors, kids, weekend]
const S = (id: string, batch_id: string, extra: Partial<AbsenceStudent> = {}): AbsenceStudent =>
  ({ id, full_name: `Student ${id}`, batch_id, branch_id: batches.find(b => b.id === batch_id)?.branch_id, ...extra })
const att = (profile_id: string, batch_id: string, present = true, class_date = today): AttendanceRow =>
  ({ profile_id, batch_id, class_date, present, is_drop_in: false })

const base = { date: today, batches, classes: [] as { batch_id: string; class_date: string; logged_at: string | null }[], leaves: [] as StudentLeave[], holidays: [] as Holiday[] }

console.log('1. who is absent')
const students = [
  S('a', 'j'), S('b', 'j'), S('c', 'j', { available_days: 'Mon,Wed,Fri' }), S('d', 'j'), S('e', 'w'), S('f', 'j', { archived_at: '2026-11-01' }),
  S('g', 's'), S('h', 'k'), S('i', 'j'),
]
const rows = [att('a', 'j'), att('i', 's')]   // a came to Juniors; i (Juniors) came as a drop-in to Seniors
const r1 = absenteesFor({ ...base, students, attendance: rows })
check('home batch day, not marked → absent', r1.groups.find(g => g.batch.id === 'j')?.students.map(s => s.id), ['b', 'd'])
check('availability: Mon/Wed/Fri student not expected Thu', r1.groups.flatMap(g => g.students).some(s => s.id === 'c'), false)
check('batch not meeting today (Weekend) → not expected', r1.groups.flatMap(g => g.students).some(s => s.id === 'e'), false)
check('archived left out', r1.groups.flatMap(g => g.students).some(s => s.id === 'f'), false)
check('drop-in present elsewhere counts as came', r1.groups.flatMap(g => g.students).some(s => s.id === 'i'), false)
check('Seniors logged only by the drop-in: g absent', r1.groups.find(g => g.batch.id === 's')?.students.map(s => s.id), ['g'])
check('Kids not logged yet → off the list, listed as waiting', [r1.groups.some(g => g.batch.id === 'k'), r1.notLogged.map(n => [n.batch.id, n.expected])], [false, [['k', 1]]])
check('total', r1.total, 3)
check('groups by start time', absenteesFor({ ...base, students, attendance: [...rows, att('x', 'k')] }).groups.map(g => g.batch.id), ['k', 'j', 's'])
const logged = absenteesFor({ ...base, students, attendance: rows, classes: [{ batch_id: 'k', class_date: today, logged_at: '2026-11-19T11:00:00Z' }] })
check('class logged with nobody present → everyone absent', logged.groups.find(g => g.batch.id === 'k')?.students.map(s => s.id), ['h'])
check('a class row from another day does not count', absenteesFor({ ...base, students, attendance: rows,
  classes: [{ batch_id: 'k', class_date: '2026-11-18', logged_at: 'x' }] }).notLogged.length, 1)
check('unlock-only row (logged_at empty) does not count', absenteesFor({ ...base, students, attendance: rows,
  classes: [{ batch_id: 'k', class_date: today, logged_at: null }] }).notLogged.length, 1)

console.log('\n2. holidays and leave')
const H = (branch_id: string | null, holiday_date = today, removed_at: string | null = null): Holiday => ({ id: 'h', branch_id, holiday_date, name: 'Diwali', removed_at })
const withAll = absenteesFor({ ...base, students, attendance: rows, holidays: [H(null)] })
check('all-branch holiday: nobody absent, nothing waiting', [withAll.total, withAll.notLogged.length], [0, 0])
const kokOnly = absenteesFor({ ...base, students, attendance: [...rows, att('x', 'k')], holidays: [H('kok')] })
check('branch holiday closes only that branch', kokOnly.groups.map(g => g.batch.id), ['k'])
check('removed holiday ignored', absenteesFor({ ...base, students, attendance: rows, holidays: [H(null, today, 'x')] }).total, 3)
check("another day's holiday ignored", absenteesFor({ ...base, students, attendance: rows, holidays: [H(null, '2026-11-18')] }).total, 3)
const L = (profile_id: string, from_date: string, to_date: string, cancelled_at: string | null = null): StudentLeave =>
  ({ id: profile_id, profile_id, from_date, to_date, note: null, cancelled_at })
const leave = absenteesFor({ ...base, students, attendance: rows, leaves: [L('b', '2026-11-17', '2026-11-20'), L('d', '2026-11-19', '2026-11-19', 'x'), L('g', '2026-11-10', '2026-11-18')] })
check('on leave covering today → not absent', leave.groups.find(g => g.batch.id === 'j')?.students.map(s => s.id), ['d'])
check('cancelled leave → still absent', leave.groups.find(g => g.batch.id === 'j')?.students.some(s => s.id === 'd'), true)
check('leave ended yesterday → absent', leave.groups.find(g => g.batch.id === 's')?.students.map(s => s.id), ['g'])
check('on-leave count', leave.onLeave, 1)

console.log('\n3. message')
check('fill', fillTemplate('{child_name} · {date} · {batch_time} · {dojo_name} · {name}', { child_name: 'Aarav', date: '19 Nov', batch_time: '5 pm', dojo_name: 'DSSKA' }),
  'Aarav · 19 Nov · 5 pm · DSSKA · {name}')
check('unknown placeholders', unknownPlaceholders('Hi {child_name}, {name} {date} {x y}'), ['{name}'])
check('empty template', templateProblem('  '), 'Write the message (or tap Use the standard message).')
check('standard template fine', templateProblem(DEFAULT_ABSENCE_BODY), '')
const kid: AbsenceStudent = { id: 'a', full_name: 'Aarav Reddy', phone: null, guardian_name: 'Priya Reddy', guardian_phone: '+919876543210', guardian_relation: 'Mother' }
const m = absenceMessage({ student: kid, batch: juniors, date: today, companyName: 'DSSKA Kokapet', country: 'IN' })
check('to the parent', [m.toPhone, m.toParent, m.toLabel], ['919876543210', true, 'Mother (Priya Reddy)'])
check('standard text', m.text, "Namaste Priya 🙏\nAarav did not attend today's karate class (19 Nov, 5 pm batch) at DSSKA Kokapet. Please let us know if all is well.")
const own = absenceMessage({ student: { ...kid, guardian_phone: null, phone: '+919000000001' }, batch: seniors, date: today, companyName: 'DSSKA', body: 'we missed {child_name} at the {batch_time} class.', country: 'IN' })
check('no parent → the student, own template', [own.toPhone, own.toParent, own.text], ['919000000001', false, 'Namaste Aarav 🙏\nWe missed Aarav at the 7 pm class.'])
check('no WhatsApp number', absenceMessage({ student: { ...kid, guardian_phone: null }, batch: juniors, date: today, companyName: 'D', country: 'IN' }).toPhone, null)

console.log('\n4. send to all')
let run = startRun(['a', 'b', 'c'])
check('first', [runCurrent(run), runProgress(run)], ['a', '1 of 3'])
run = advance(run, 'opened')
check('next', [runCurrent(run), runProgress(run)], ['b', '2 of 3'])
run = advance(advance(run, 'skipped'), 'opened')
check('done', [runDone(run), runCurrent(run), runSummary(run)], [true, null, 'Done: 2 opened, 1 skipped'])

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

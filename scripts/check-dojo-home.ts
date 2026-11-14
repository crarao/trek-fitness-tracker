// Prints the dojo home rules (lib/dojo-home.ts) for sample inputs. Fails (exit 1) on a wrong answer.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-dojo-home.ts --outDir /tmp/cdh --module commonjs --target es2020 --skipLibCheck && node /tmp/cdh/scripts/check-dojo-home.js
// Runs in India time (Asia/Kolkata), like the dojo's phones: daysLeft (moved unchanged from the dashboard) reads the
// end date as UTC midnight, so the answers depend on the time zone. The script sets it itself.
process.env.TZ = 'Asia/Kolkata'

import {
  batchState, todaySummary, todaySummaryText, markedByName, feesToCollect, notSeen, parentLine,
  lastPresentDates, firstNamesLine, telHref, daysLeft, membershipStatus, type FeeStudent,
} from '../lib/dojo-home'
import { type AttendanceRow } from '../lib/attendance'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2026, 10, 14, h, m) }   // Sat 14 Nov 2026
const TODAY = '2026-11-14'
const juniors = { id: 'b1', start_time: '17:00:00', end_time: '18:00:00' }
const noEnd = { id: 'b2', start_time: '07:00', end_time: null }
const noStart = { id: 'b3', start_time: null, end_time: null }
const row = (batch: string, profile: string, present = true, by = 'u-owner', date = TODAY): AttendanceRow =>
  ({ batch_id: batch, profile_id: profile, class_date: date, present, is_drop_in: false, marked_by: by })

console.log('1. batchState (Juniors 5–6 pm, India)')
check('before the start', batchState(juniors, [], at('16:30'), 'IN'), { kind: 'upcoming', startsLabel: '5 pm' })
check('during, no roll call yet', batchState(juniors, [], at('17:20'), 'IN'), { kind: 'on' })
check('during, 2 came', batchState(juniors, [row('b1', 's1'), row('b1', 's2')], at('17:20'), 'IN'), { kind: 'done', came: 2 })
check('after the end, nobody marked', batchState(juniors, [], at('18:00'), 'IN'), { kind: 'missed', endedLabel: '6 pm' })
check('after the end, 1 came', batchState(juniors, [row('b1', 's1')], at('19:00'), 'IN'), { kind: 'done', came: 1 })
check('untapped rows (present false) do not count', batchState(juniors, [row('b1', 's1', false)], at('19:00'), 'IN'), { kind: 'missed', endedLabel: '6 pm' })
check("yesterday's rows do not count", batchState(juniors, [row('b1', 's1', true, 'u', '2026-11-13')], at('19:00'), 'IN'), { kind: 'missed', endedLabel: '6 pm' })
check("another batch's rows do not count", batchState(juniors, [row('b9', 's1')], at('19:00'), 'IN'), { kind: 'missed', endedLabel: '6 pm' })
check('no end time: on until start + 60 min', batchState(noEnd, [], at('07:59'), 'IN'), { kind: 'on' })
check('no end time: missed after start + 60 min', batchState(noEnd, [], at('08:00'), 'IN'), { kind: 'missed', endedLabel: '8 am' })
check('no start time', batchState(noStart, [], at('12:00'), 'IN'), { kind: 'no-time' })
check('12-hour India time 6:30 pm', batchState({ id: 'b4', start_time: '18:30', end_time: '19:30' }, [], at('12:00'), 'IN'), { kind: 'upcoming', startsLabel: '6:30 pm' })
check('US time 6:30 PM', batchState({ id: 'b4', start_time: '18:30', end_time: '19:30' }, [], at('12:00'), 'US'), { kind: 'upcoming', startsLabel: '6:30 PM' })
check('US missed line', batchState({ id: 'b4', start_time: '18:30', end_time: '19:30' }, [], at('20:00'), 'US'), { kind: 'missed', endedLabel: '7:30 PM' })

console.log('2. todaySummary')
const states = [
  batchState(juniors, [row('b1', 's1'), row('b1', 's2')], at('19:00'), 'IN'),
  batchState(noEnd, [], at('19:00'), 'IN'),
  batchState({ id: 'b5', start_time: '20:00', end_time: '21:00' }, [], at('19:00'), 'IN'),
  batchState({ id: 'b6', start_time: '06:00', end_time: '07:00' }, [row('b6', 's3')], at('19:00'), 'IN'),
]
check('2 of 4 done, 3 came, 1 missed', todaySummary(states), { done: 2, total: 4, came: 3, missed: 1 })
check('summary line', todaySummaryText(todaySummary(states)), '2 of 4 batches done · 3 came · 1 missed')
check('no "· 0 missed"', todaySummaryText({ done: 1, total: 1, came: 18, missed: 0 }), '1 of 1 batch done · 18 came')
check('no batches', todaySummaryText(todaySummary([])), '')

console.log('3. markedByName')
const staff = { 'u-owner': { full_name: 'Anand Rao', role: 'company_admin' }, 'u-ravi': { full_name: 'Sensei Ravi Kumar', role: 'coach' } }
check('owner marked most → first name', markedByName([row('b1', 's1'), row('b1', 's2'), row('b1', 's3', true, 'u-ravi')], staff), 'Anand')
check('sensei marked most → "Sensei Ravi"', markedByName([row('b1', 's1', true, 'u-ravi'), row('b1', 's2', true, 'u-ravi')], staff), 'Sensei Ravi')
check('unknown person → nothing', markedByName([row('b1', 's1', true, 'u-who')], staff), '')
check('no rows → nothing', markedByName([], staff), '')

console.log('4. Membership rules (moved from the dashboard, unchanged; India time)')
const now = new Date(2026, 10, 14, 10, 0)
check('ends 20 Nov → 7 days left', daysLeft('2026-11-20', now), 7)
check('ends 21 Nov → 8 days left', daysLeft('2026-11-21', now), 8)
check('ends 13 Nov → 0 (still "expiring" today)', daysLeft('2026-11-13', now), 0)
check('ends 12 Nov → -1 expired', membershipStatus({ amount_paid: 1, start_date: '2026-10-12', end_date: '2026-11-12' }, now), 'expired')

console.log('5. feesToCollect')
const mem = (end: string, amount: number, currency: string | null = 'INR') => ({ plan_type: '1 Month', amount_paid: amount, start_date: '2026-10-01', end_date: end, currency })
const st = (id: string, name: string, end: string | null, amount = 1500, extra: Partial<FeeStudent> = {}): FeeStudent =>
  ({ id, full_name: name, phone: null, archived_at: null, memberships: end ? [mem(end, amount)] : [], ...extra })
const mother = { guardian_name: 'Priya Sharma', guardian_phone: '+919876543210', guardian_relation: 'Mother' }
const father = { guardian_name: 'Vikram Rao', guardian_phone: '+919812345678', guardian_relation: 'Father' }
const students: FeeStudent[] = [
  st('a', 'Aarav Sharma', '2026-11-16', 1500, mother),                 // due in 3 days
  st('n', 'Anaya Rao', '2026-11-18', 1500, father),                    // sibling 1
  st('j', 'Arjun Rao', '2026-11-17', 1200, { ...father, guardian_phone: '9812345678' }),   // sibling 2, same phone, old format
  st('w', 'Week Eight', '2026-11-21', 1500),                          // 8 days left: not due this week
  st('l', 'Lapsed Lately', '2026-11-05', 1500, { phone: '+919900011122' }),   // lapsed
  st('o', 'Long Gone', '2026-08-01', 1500),                           // lapsed 105 days ago: left out (60 days)
  st('x', 'Archived Kid', '2026-11-16', 1500, { archived_at: '2026-11-10T00:00:00Z' }),   // archived: left out
  st('z', 'No Plan', null),                                            // no membership: left out
]
const fees = feesToCollect({ students, today: now, baseCurrency: 'INR', country: 'IN' })
check('due this week (rows)', fees.dueThisWeek.map(r => r.name), ['Priya Sharma', 'Vikram Rao'])
check('due within 7 days vs 8 days', fees.dueThisWeek.some(r => r.students.some(s => s.id === 'w')), false)
check('siblings → one row, amounts added', fees.dueThisWeek[1] && { line: fees.dueThisWeek[1].line, amount: fees.dueThisWeek[1].amount, due: fees.dueThisWeek[1].dueDate }, { line: 'Father of Arjun & Anaya', amount: 2700, due: '2026-11-17' })
check('parent line', fees.dueThisWeek[0]?.line, 'Mother of Aarav')
check('lapsed (last 60 days only)', fees.lapsed.map(r => r.name), ['Lapsed Lately'])
check('lapsed with no parent: no parent line', fees.lapsed[0]?.line, '')
check('archived student left out', [...fees.dueThisWeek, ...fees.lapsed].some(r => r.students.some(s => s.id === 'x')), false)
check('totals: ₹1,500 + ₹2,700 + ₹1,500, 3 parents', fees.totals, { byCurrency: [{ currency: 'INR', amount: 5700 }], parents: 3 })
const two = feesToCollect({
  students: [st('u1', 'Usha', '2026-11-16', 200, { memberships: [mem('2026-11-16', 200, 'USD')] }), st('i1', 'Ishaan', '2026-11-16', 1500)],
  today: now, baseCurrency: 'INR', country: 'IN',
})
check('two currencies → two totals', two.totals.byCurrency, [{ currency: 'INR', amount: 1500 }, { currency: 'USD', amount: 200 }])
check('call: parent phone in E.164', telHref(fees.dueThisWeek[1]?.phone, 'IN'), 'tel:+919812345678')
check('call: student phone when no parent', telHref(fees.lapsed[0]?.phone, 'IN'), 'tel:+919900011122')
check('call: unreadable phone → none', telHref('12', 'IN'), null)

console.log('6. parentLine')
check('guardian set', parentLine(st('a', 'Aarav Sharma', null, 0, mother)), 'Mother of Aarav')
check('no guardian → nothing', parentLine(st('a', 'Aarav Sharma', null)), '')
check('three children', parentLine([st('1', 'Anaya R', null, 0, father), st('2', 'Arjun R', null, 0, father), st('3', 'Avni R', null, 0, father)]), 'Father of Anaya, Arjun & Avni')
check('guardian without relation', parentLine(st('a', 'Aarav', null, 0, { guardian_name: 'Priya', guardian_relation: null })), 'Parent of Aarav')

console.log('7. notSeen (today 14 Nov, 14 days)')
const kid = (id: string, joined: string, extra: Record<string, unknown> = {}) =>
  ({ id, full_name: id, created_at: `${joined}T10:00:00Z`, archived_at: null, memberships: [mem('2026-12-31', 1500)], ...extra })
const rows = [
  { profile_id: 'seen', class_date: '2026-11-10' },
  { profile_id: 'away', class_date: '2026-10-25' },
  { profile_id: 'away', class_date: '2026-10-20' },
]
const lp = lastPresentDates(rows)
check('last present per student + first day', lp, { last: { seen: '2026-11-10', away: '2026-10-25' }, since: '2026-10-20' })
const pool = [
  kid('new5', '2026-11-09'),                       // joined 5 days ago, no attendance: not listed
  kid('old20', '2026-10-25'),                      // joined 20 days ago, never came: listed (counts from join)
  kid('seen', '2026-01-01'),                       // came 4 days ago
  kid('away', '2026-01-01'),                       // last came 25 Oct: 20 days away
  kid('gone', '2026-01-01', { memberships: [mem('2026-11-01', 1500)] }),   // expired: left out
  kid('arch', '2026-01-01', { archived_at: '2026-11-01T00:00:00Z' }),      // archived: left out
  kid('early', '2026-01-01'),                      // joined long ago, never came: counts from 20 Oct (first attendance) → 25 days
]
const ns = notSeen({ students: pool, lastPresentByStudent: lp.last, attendanceSince: lp.since, today: TODAY })
check('listed, longest away first', ns.map(r => [r.student.id, r.daysAway, r.lastPresent]), [['early', 25, null], ['old20', 20, null], ['away', 20, '2026-10-25']])
check('joined 5 days ago → not "not seen"', ns.some(r => r.student.id === 'new5'), false)
check('archived and expired left out', ns.some(r => ['arch', 'gone'].includes(r.student.id)), false)
const started = lastPresentDates([{ profile_id: 'seen', class_date: '2026-11-08' }])
check('attendance started 6 days ago → nobody yet', notSeen({ students: pool, lastPresentByStudent: started.last, attendanceSince: started.since, today: TODAY }).length, 0)
check('no attendance at all → nobody', notSeen({ students: pool, lastPresentByStudent: {}, attendanceSince: null, today: TODAY }).length, 0)
check('first names line', firstNamesLine(['Aarav Sharma', 'Diya K', 'Kabir', 'Meera', 'Zoya']), 'Aarav, Diya, Kabir and 2 more')
check('first names line, 2 names', firstNamesLine(['Aarav Sharma', 'Diya K']), 'Aarav, Diya')

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
process.exit(failed ? 1 : 0)

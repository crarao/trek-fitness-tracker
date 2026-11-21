// Prints the dojo leave + availability rules (lib/leave.ts) for sample inputs. Fails (exit 1) on a wrong answer.
//   npx tsc scripts/check-leave.ts --outDir /tmp/cleave --module commonjs --target es2020 --skipLibCheck && node /tmp/cleave/scripts/check-leave.js

import { type StudentLeave, leaveOn, leaveText, leaveProblem, leaveRow, parseDays, expectedDays, availabilityValue, attendsLabel } from '../lib/leave'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

const L = (id: string, profile_id: string, from_date: string, to_date: string, cancelled_at: string | null = null): StudentLeave =>
  ({ id, profile_id, from_date, to_date, note: null, cancelled_at })
const leaves = [L('1', 'a', '2026-11-18', '2026-11-24'), L('2', 'a', '2026-11-19', '2026-11-20'), L('3', 'b', '2026-11-19', '2026-11-19', '2026-11-19T09:00:00Z'), L('4', 'c', '2026-11-10', '2026-11-12')]

console.log('1. leave')
check('on leave, the longer of two overlapping', leaveOn(leaves, 'a', '2026-11-19')?.id, '1')
check('first day counts', leaveOn(leaves, 'a', '2026-11-18')?.id, '1')
check('last day counts', leaveOn(leaves, 'a', '2026-11-24')?.id, '1')
check('day after: not on leave', leaveOn(leaves, 'a', '2026-11-25'), null)
check('cancelled leave ignored', leaveOn(leaves, 'b', '2026-11-19'), null)
check('past leave ignored', leaveOn(leaves, 'c', '2026-11-19'), null)
check('text: until', leaveText({ to_date: '2026-11-24' }, '2026-11-19', 'IN'), 'On leave until 24 Nov')
check('text: just today', leaveText({ to_date: '2026-11-19' }, '2026-11-19', 'IN'), 'On leave today')
check('until before from', leaveProblem({ from: '2026-11-19', to: '2026-11-18' }), "The last day can't be before the first.")
check('same day fine', leaveProblem({ from: '2026-11-19', to: '2026-11-19' }), '')
check('no date', leaveProblem({ from: '2026-11-19', to: '' }), 'Pick the last day of leave.')
check('row: empty note = null', leaveRow({ companyId: 'co', profileId: 'a', from: '2026-11-19', to: '2026-11-20', note: '  ', markedBy: 'm' }).note, null)

console.log('\n2. availability')
const batch = ['Mon', 'Wed', 'Fri']
check('parse "Mon,Wed,Fri"', parseDays('Mon,Wed,Fri'), ['Mon', 'Wed', 'Fri'])
check('parse loose "fri, monday"', parseDays('fri, monday'), ['Mon', 'Fri'])
check('expected: empty = all batch days', expectedDays(null, batch), ['Mon', 'Wed', 'Fri'])
check('expected: narrowed', expectedDays('Mon,Fri', batch), ['Mon', 'Fri'])
check('expected: extra days outside the batch dropped', expectedDays('Mon,Tue', batch), ['Mon'])
check('expected: no overlap = all batch days', expectedDays('Tue,Thu', batch), ['Mon', 'Wed', 'Fri'])
check('save: some days', availabilityValue(['Fri', 'Mon'], batch), 'Mon,Fri')
check('save: all days = null', availabilityValue(['Mon', 'Wed', 'Fri'], batch), null)
check('save: none = null', availabilityValue([], batch), null)
check('save: off-batch days dropped', availabilityValue(['Tue', 'Wed'], batch), 'Wed')
check('label when narrowed', attendsLabel('Mon,Fri', batch), 'Attends: Mon, Fri')
check('no label when all days', attendsLabel(null, batch), '')
check('no label without a batch', attendsLabel('Mon', []), '')

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

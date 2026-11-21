// Prints the dojo holiday rules (lib/holidays.ts) for sample inputs. Fails (exit 1) on a wrong answer.
//   npx tsc scripts/check-holidays.ts --outDir /tmp/chol --module commonjs --target es2020 --skipLibCheck && node /tmp/chol/scripts/check-holidays.js

import { type Holiday, holidayFor, noClassesText, holidaysShown, canAdd, holidayProblem, monthGrid, shiftMonth, monthBounds } from '../lib/holidays'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

const H = (id: string, branch_id: string | null, holiday_date: string, name: string, removed_at: string | null = null): Holiday =>
  ({ id, branch_id, holiday_date, name, removed_at })
const list = [
  H('1', null, '2026-11-08', 'Diwali'),
  H('2', 'kok', '2026-11-20', 'Kokapet maintenance'),
  H('3', null, '2026-11-20', 'Old', '2026-11-01T00:00:00Z'),
  H('4', 'kok', '2026-11-08', 'Kokapet Diwali'),
]

console.log('1. which holiday closes a branch')
check('all branches closes every branch', holidayFor(list, 'gach', '2026-11-08')?.name, 'Diwali')
check("the branch's own wins over all branches", holidayFor(list, 'kok', '2026-11-08')?.name, 'Kokapet Diwali')
check('branch holiday closes only that branch', holidayFor(list, 'gach', '2026-11-20'), null)
check('branch holiday', holidayFor(list, 'kok', '2026-11-20')?.id, '2')
check('removed holidays ignored', holidayFor(list, null, '2026-11-20'), null)
check('no branch: only all-branch holidays', holidayFor(list, null, '2026-11-08')?.name, 'Diwali')
check('text', noClassesText({ name: 'Diwali' }), 'No classes — Diwali')

console.log('\n2. calendar')
check('All shows every holiday that day', holidaysShown(list, 'all', '2026-11-08').map(h => h.id), ['1', '4'])
check('a branch shows its own + all branches', holidaysShown(list, 'gach', '2026-11-08').map(h => h.id), ['1'])
check('can add for a branch with only an all-branch one', canAdd(list, 'gach', '2026-11-08'), true)
check("can't add a second all-branches one", canAdd(list, 'all', '2026-11-08'), false)
check('can add again after removal', canAdd(list, 'all', '2026-11-20'), true)
check('name needed', holidayProblem('  '), 'Give the holiday a name (e.g. Diwali).')
check('name fine', holidayProblem('Diwali'), '')
const nov = monthGrid('2026-11-19')
check('Nov 2026 starts on Sunday (6 blanks)', nov[0], [null, null, null, null, null, null, '2026-11-01'])
check('weeks', nov.length, 6)
check('last day', nov[5][0], '2026-11-30')
check('next month', shiftMonth('2026-11-19', 1), '2026-12-01')
check('previous month over the year', shiftMonth('2026-01-15', -1), '2025-12-01')
check('bounds', monthBounds('2026-02-10'), { from: '2026-02-01', to: '2026-02-28' })

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

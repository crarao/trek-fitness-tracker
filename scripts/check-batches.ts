// Prints the branch / batch rules (lib/batches.ts) for sample inputs. Fails (exit 1) on a wrong answer.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-batches.ts --outDir /tmp/cb --module commonjs --target es2020 --skipLibCheck && node /tmp/cb/scripts/check-batches.js

import { daysLabel, timeLabel, timeRange, batchWhen, homeBatchLine, sortBatches, nameTaken, batchProblem, sortDays } from '../lib/batches'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

console.log('1. daysLabel')
check('Mon/Wed/Fri', daysLabel(['Fri', 'Mon', 'Wed']), 'Mon/Wed/Fri')
check('Mon–Fri', daysLabel(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']), 'Mon–Fri')
check('every day', daysLabel(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']), 'Daily')
check('Sat/Sun', daysLabel(['Sun', 'Sat']), 'Sat/Sun')
check('Mon–Wed/Sat', daysLabel(['Mon', 'Tue', 'Wed', 'Sat']), 'Mon–Wed/Sat')
check('unknown day ignored, repeats removed', sortDays(['Tue', 'Funday', 'Tue']), ['Tue'])
check('none', daysLabel([]), '')

console.log('\n2. times (India vs US)')
check('18:00 India', timeLabel('18:00', 'IN'), '6 pm')
check('18:30:00 US', timeLabel('18:30:00', 'US'), '6:30 PM')
check('00:15 midnight', timeLabel('00:15', 'IN'), '12:15 am')
check('12:00 noon', timeLabel('12:00', 'IN'), '12 pm')
check('range same half', timeRange('18:00', '19:00', 'IN'), '6–7 pm')
check('range across noon', timeRange('11:00', '12:30', 'IN'), '11 am–12:30 pm')
check('no end', timeRange('06:30', null, 'IN'), '6:30 am')
check('no start', timeRange(null, '07:00', 'IN'), '')

console.log('\n3. batchWhen / homeBatchLine')
const juniors = { name: 'Juniors', days: ['Mon', 'Wed', 'Fri'], start_time: '18:00:00', end_time: '19:00:00' }
check('batchWhen', batchWhen(juniors, 'IN'), 'Mon/Wed/Fri · 6–7 pm')
check('row line, full', homeBatchLine({ name: 'Kokapet' }, juniors, 'IN'), 'Kokapet · Juniors · Mon/Wed/Fri 6–7 pm')
check('row line, branch only', homeBatchLine({ name: 'Kokapet' }, null, 'IN'), 'Kokapet')
check('row line, nothing', homeBatchLine(null, null, 'IN'), '')

console.log('\n4. sortBatches (by start time, archived last)')
const list = [
  { name: 'Seniors', start_time: '19:00:00', is_archived: false },
  { name: 'Old', start_time: '06:00:00', is_archived: true },
  { name: 'Kids', start_time: '17:00:00', is_archived: false },
  { name: 'Open mat', start_time: null, is_archived: false },
]
check('order', sortBatches(list).map(b => b.name), ['Kids', 'Seniors', 'Open mat', 'Old'])

console.log('\n5. nameTaken / batchProblem')
const rows = [{ id: 'b1', name: 'Kokapet' }, { id: 'b2', name: 'Gachibowli' }]
check('same name, other case/spaces', nameTaken(rows, '  kokapet '), true)
check('renaming itself is fine', nameTaken(rows, 'Kokapet', 'b1'), false)
check('new name', nameTaken(rows, 'Manikonda'), false)
check('batch ok', batchProblem({ name: 'Juniors', days: ['Mon'], start_time: '18:00', end_time: '19:00' }), '')
check('batch no name', batchProblem({ name: ' ', days: ['Mon'], start_time: '', end_time: '' }), 'Add a name for the batch (e.g. Juniors).')
check('batch no days', batchProblem({ name: 'Juniors', days: [], start_time: '', end_time: '' }), 'Pick at least one day.')
check('batch end before start', batchProblem({ name: 'Juniors', days: ['Mon'], start_time: '19:00', end_time: '18:00' }), 'The end time must be after the start time.')

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

// Prints the class-mode rule (lib/labels.ts isClassBased / canRunClasses) for every business type and branch count.
// Fails (exit 1) when martial arts gives anything but isDojo(), or a type other than yoga changes.
//   npx tsc scripts/check-class-based.ts --outDir /tmp/cclass --module commonjs --target es2020 --skipLibCheck && node /tmp/cclass/scripts/check-class-based.js

import { BUSINESS_TYPES, isDojo, isYoga, canRunClasses, isClassBased, memberWord, staffWord, ptWord, placeWord } from '../lib/labels'
import { groupByCategory, YOGA_STARTER_ACTIVITIES } from '../lib/dojo-activities'
import { defaultAbsenceBody, DEFAULT_ABSENCE_BODY, unknownPlaceholders } from '../lib/absences'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

const values: (string | null | undefined)[] = [...BUSINESS_TYPES.map(t => t.value), null, undefined, '', 'Yoga', 'unknown']
const counts: (number | null | undefined)[] = [null, undefined, 0, 1, 2, 5]

console.log('1. martial arts: exactly isDojo() whatever the branch count')
for (const n of counts) check(`martial_arts, ${n} branches`, isClassBased('martial_arts', n), isDojo('martial_arts'))

console.log('2. every other value: same as isDojo() (false), except yoga with a branch')
for (const v of values) for (const n of counts) {
  const expected = isDojo(v) || (v === 'yoga' && (n ?? 0) > 0)
  check(`${JSON.stringify(v)}, ${n} branches`, isClassBased(v, n), expected)
}

console.log('3. who is asked for branches')
for (const v of values) check(`canRunClasses(${JSON.stringify(v)})`, canRunClasses(v), v === 'martial_arts' || v === 'yoga')
check('isYoga only for yoga', values.filter(isYoga), ['yoga'])

console.log('4. dojo words unchanged')
check('martial arts member word', memberWord('martial_arts'), { one: 'Student', many: 'Students' })
check('martial arts staff word', staffWord('martial_arts'), { one: 'Sensei', many: 'Senseis' })
check('martial arts pt word', [ptWord('martial_arts'), ptWord('martial_arts', true), ptWord('martial_arts', false)], ['students', 'students', 'students'])
check('yoga words', [memberWord('yoga'), staffWord('yoga'), ptWord('yoga'), ptWord('yoga', true)], [{ one: 'Member', many: 'Members' }, { one: 'Trainer', many: 'Trainers' }, 'PT clients', 'members'])
check('gym words', [memberWord('gym'), staffWord('gym'), ptWord('gym')], [{ one: 'Member', many: 'Members' }, { one: 'Coach', many: 'Coaches' }, 'PT clients'])

console.log('5. activity categories')
const flat = [{ id: 'a' }, { id: 'b', category: null }, { id: 'c', category: '' }]
check('no categories = one flat group, same items', groupByCategory(flat), [{ category: null, items: flat }])
const mixed = [{ id: 'a', category: 'Asana' }, { id: 'b' }, { id: 'c', category: 'Pranayama' }, { id: 'd', category: 'Asana' }]
check('grouped in first-seen order, uncategorised last', groupByCategory(mixed).map(g => [g.category, g.items.map(i => i.id)]),
  [['Asana', ['a', 'd']], ['Pranayama', ['c']], [null, ['b']]])
check('yoga starter list: 4–6 per category', groupByCategory(YOGA_STARTER_ACTIVITIES).map(g => [g.category, g.items.length]),
  [['Asana', 6], ['Pranayama', 5], ['Meditation', 4], ['Yoga Nidra', 4]])

console.log('6. absence message + place word')
check('dojo standard message unchanged', defaultAbsenceBody('martial_arts'), DEFAULT_ABSENCE_BODY)
check('no business type = dojo message', defaultAbsenceBody(null), DEFAULT_ABSENCE_BODY)
check('yoga message: no karate', /karate/i.test(defaultAbsenceBody('yoga')), false)
check('yoga message: only known placeholders', unknownPlaceholders(defaultAbsenceBody('yoga')), [])
check('place words', ['martial_arts', 'yoga', 'gym'].map(placeWord), ['Dojo', 'Studio', 'Gym'])

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1) }
console.log('\nAll checks passed')

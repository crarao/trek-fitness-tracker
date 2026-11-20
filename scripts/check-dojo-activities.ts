// Prints the dojo activity + 7-day lock rules (lib/dojo-activities.ts) for sample inputs. Fails (exit 1) on a wrong answer.
//   npx tsc scripts/check-dojo-activities.ts --outDir /tmp/cact --module commonjs --target es2020 --skipLibCheck && node /tmp/cact/scripts/check-dojo-activities.js

import {
  type DojoActivity, sortActivities, activityNameTaken, activityProblem, nextSortOrder, moveActivity,
  checklist, activityRowsToSave, ticksSummary, olderThanLock, dayLocked, lockAction, saveErrorText,
  appliesToBelt, itemShown, categoriesOf, itemsOf, fromBeltText,
} from '../lib/dojo-activities'

let failed = 0
const check = (label: string, value: unknown, expected: unknown) => {
  const ok = JSON.stringify(value) === JSON.stringify(expected)
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(50)} → ${JSON.stringify(value)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`)
}

const a = (id: string, name: string, sort_order: number, is_default = false, is_archived = false): DojoActivity =>
  ({ id, name, description: null, sort_order, is_default, is_archived })
const list = [a('k', 'Kicks', 4), a('g', 'General warm-up', 1, true), a('h', 'Hard warm-up', 2, true), a('b', 'Basics', 3), a('w', 'Weapons', 5, false, true)]

console.log('1. list')
check('sorted by order', sortActivities(list).map(x => x.id), ['g', 'h', 'b', 'k', 'w'])
check('name taken, case / spaces ignored', activityNameTaken(list, '  basics '), true)
check('own name not taken when editing', activityNameTaken(list, 'Basics', 'b'), false)
check('archived names still taken (unique index)', activityNameTaken(list, 'weapons'), true)
check('empty name', activityProblem({ name: '  ' }), 'Give the activity a name.')
check('long name', activityProblem({ name: 'x'.repeat(61) }), 'Keep the name under 60 characters.')
check('fine', activityProblem({ name: 'Kata practice', description: 'Lower to higher katas' }), '')
check('next sort order', nextSortOrder(list), 6)
check('move Basics up', moveActivity(list, 'b', -1), [{ id: 'b', sort_order: 2 }, { id: 'h', sort_order: 3 }])
check('move first up = nothing', moveActivity(list, 'g', -1), [])
check('move last active down = nothing (archived skipped)', moveActivity(list, 'k', 1), [])
const ties = [a('x', 'X', 1), a('y', 'Y', 1), a('z', 'Z', 1)]
check('ties renumbered on move', moveActivity(ties, 'z', -1), [{ id: 'z', sort_order: 2 }, { id: 'y', sort_order: 3 }])

console.log('\n2. checklist')
const fresh = checklist({ activities: list, cls: null, saved: [] })
check('new class: defaults pre-ticked, not logged', [fresh.logged, fresh.items.filter(i => i.ticked).map(i => i.id)], [false, ['g', 'h']])
check('new class: archived left out', fresh.items.map(i => i.id), ['g', 'h', 'b', 'k'])
const unlockOnly = checklist({ activities: list, cls: { logged_at: null }, saved: [] })
check('row made only to unlock: still pre-ticked', unlockOnly.items.filter(i => i.ticked).map(i => i.id), ['g', 'h'])
const saved = [
  { class_id: 'c', activity_id: 'g', activity_name: 'General warm-up', removed_at: '2026-11-19T10:00:00Z' },
  { class_id: 'c', activity_id: 'b', activity_name: 'Basics', removed_at: null },
  { class_id: 'c', activity_id: 'w', activity_name: 'Weapon training', removed_at: null },
]
const done = checklist({ activities: list, cls: { logged_at: '2026-11-19T10:00:00Z' }, saved })
check('logged class: exactly what was saved', done.items.filter(i => i.ticked).map(i => i.id), ['b', 'w'])
check('unticked default stays unticked', done.items.find(i => i.id === 'g')?.ticked, false)
check('archived but ticked: shown with the saved name', done.items.find(i => i.id === 'w')?.name, 'Weapon training')
check('summary', ticksSummary(done.items), '2 activities')
check('summary, one', ticksSummary([{ ticked: true }]), '1 activity')
const now = '2026-11-19T12:00:00Z'
check('rows: ticked + previously saved only', activityRowsToSave({ classId: 'c', companyId: 'co', items: done.items, saved, now })
  .map(r => `${r.activity_id}:${r.removed_at ? 'off' : 'on'}`), ['g:off', 'b:on', 'w:on'])
check('rows for a new class: just the ticks', activityRowsToSave({ classId: 'c', companyId: 'co', items: fresh.items, saved: [], now })
  .map(r => r.activity_id), ['g', 'h'])

console.log('\n3. 7-day lock')
const today = '2026-11-19'
check('7 days back: open', olderThanLock('2026-11-12', today), false)
check('8 days back: old', olderThanLock('2026-11-11', today), true)
check('locked when old and not unlocked', dayLocked('2026-11-11', today, null), true)
check('unlocked by the owner: open', dayLocked('2026-11-11', today, { unlocked_at: now }), false)
check('owner on an old locked day', lockAction({ date: '2026-11-11', today, cls: null, role: 'company_admin' }), 'unlock')
check('owner on an unlocked day', lockAction({ date: '2026-11-11', today, cls: { unlocked_at: now }, role: 'company_admin' }), 'lock')
check('partner never', lockAction({ date: '2026-11-11', today, cls: null, role: 'partner' }), null)
check('owner on a recent day: nothing', lockAction({ date: '2026-11-15', today, cls: null, role: 'company_admin' }), null)
check('trigger text shown as is', saveErrorText({ message: 'Attendance for 2026-11-01 is locked (older than 7 days). Ask the owner to unlock it.' }),
  'Attendance for 2026-11-01 is locked (older than 7 days). Ask the owner to unlock it.')
check('other errors prefixed', saveErrorText({ message: 'network down' }), 'Could not save: network down')
check('no rows back', saveErrorText(null), "Couldn't save: not allowed for this login")

console.log('\n4. items by belt')
const ranks = [
  { id: 'w', rank_order: 1, belt_name: 'White', kyu: null, color_hex: '#fff', is_active: true },
  { id: 'y', rank_order: 2, belt_name: 'Yellow', kyu: 8, color_hex: '#ff0', is_active: true },
  { id: 'b3', rank_order: 7, belt_name: 'Brown', kyu: 3, color_hex: '#730', is_active: true },
]
const kata: DojoActivity = { ...a('kata', 'Kata practice', 6) }
const heian: DojoActivity = { ...a('hs', 'Heian Shodan', 1, true), parent_id: 'kata', min_rank_id: 'w' }
const bassai: DojoActivity = { ...a('bd', 'Bassai Dai', 7), parent_id: 'kata', min_rank_id: 'b3' }
const tree = [kata, bassai, heian, a('wu', 'Warm-up', 1, true)]
check('categories only', categoriesOf(tree).map(x => x.id), ['wu', 'kata'])
check('items of a category, in order', itemsOf(tree, 'kata').map(x => x.id), ['hs', 'bd'])
check('Bassai Dai: not for a Yellow belt', appliesToBelt('b3', 'y', ranks), false)
check('Bassai Dai: Brown 3 kyu yes', appliesToBelt('b3', 'b3', ranks), true)
check('Heian Shodan: higher belts keep it', appliesToBelt('w', 'b3', ranks), true)
check('no belt on the item = everyone', appliesToBelt(null, 'y', ranks), true)
check('student without a belt = lowest belt', [appliesToBelt('w', null, ranks), appliesToBelt('y', null, ranks)], [true, false])
check('grading off (no ladder) = everyone', appliesToBelt('b3', 'y', []), true)
const cl = checklist({ activities: tree, cls: null, saved: [] })
check('items are never pre-ticked (even marked default)', cl.items.filter(i => i.ticked).map(i => i.id), ['wu'])
check('items carry their category and belt', cl.items.find(i => i.id === 'bd'), { id: 'bd', name: 'Bassai Dai', description: null, ticked: false, archived: false, parentId: 'kata', minRankId: 'b3' })
check('kids batch: Bassai Dai hidden', itemShown({ minRankId: 'b3', ticked: false }, ['w', 'y'], ranks), false)
check('…shown once a Brown belt is in the class', itemShown({ minRankId: 'b3', ticked: false }, ['w', 'b3'], ranks), true)
check('…and when already ticked', itemShown({ minRankId: 'b3', ticked: true }, ['w'], ranks), true)
check('from-belt text', [fromBeltText('b3', ranks, r => `${r.belt_name} ${r.kyu}`), fromBeltText(null, ranks, r => r.belt_name)], ['Brown 3 and above', 'Every belt'])
check('move within a category only', moveActivity(itemsOf(tree, 'kata'), 'bd', -1), [{ id: 'bd', sort_order: 1 }, { id: 'hs', sort_order: 2 }])

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

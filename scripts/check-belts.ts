// Prints the belt rules (lib/belts.ts) for sample inputs, to read the results. Fails (exit 1) if a rule gives the wrong answer.
//   npx tsc scripts/check-belts.ts --outDir /tmp/cb --module commonjs --target es2020 --skipLibCheck && node /tmp/cb/scripts/check-belts.js

import { type BeltRank, beltLabel, beltOptions, defaultBeltId, gradeSource, gradingOn, ordinal, validIsoDate,
  beltsById, beltChipText, isLightBelt, gradeSourceLabel, sortGradeHistory } from '../lib/belts'

let failed = 0
const check = (label: string, value: unknown, ok: boolean) => {
  if (!ok) failed++
  console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} → ${JSON.stringify(value)}`)
}

const rank = (id: string, rank_order: number, belt_name: string, kyu: number | null, is_active = true): BeltRank =>
  ({ id, rank_order, belt_name, kyu, color_hex: '#FFFFFF', is_active })
const ladder = [rank('brown2', 7, 'Brown', 2), rank('white', 0, 'White', null), rank('yellow', 1, 'Yellow', 8), rank('old', 2, 'Orange', 7, false)]

check('White label', beltLabel(ladder[1]), beltLabel(ladder[1]) === 'White')
check('Yellow – 8th kyu', beltLabel(ladder[2]), beltLabel(ladder[2]) === 'Yellow – 8th kyu')
check('Brown – 2nd kyu', beltLabel(ladder[0]), beltLabel(ladder[0]) === 'Brown – 2nd kyu')
check('no belt → Belt not set', beltLabel(null), beltLabel(null) === 'Belt not set')
check('ordinals 1 2 3 4 11 12 13 21', [1, 2, 3, 4, 11, 12, 13, 21].map(ordinal).join(' '),
  [1, 2, 3, 4, 11, 12, 13, 21].map(ordinal).join(' ') === '1st 2nd 3rd 4th 11th 12th 13th 21st')
check('options in ladder order, inactive hidden', beltOptions(ladder).map(r => r.id), beltOptions(ladder).map(r => r.id).join() === 'white,yellow,brown2')
check('inactive kept when it is the saved one', beltOptions(ladder, 'old').map(r => r.id), beltOptions(ladder, 'old').map(r => r.id).join() === 'white,yellow,old,brown2')
check('default belt = White', defaultBeltId(ladder), defaultBeltId(ladder) === 'white')
check('no belts → no default', defaultBeltId([]), defaultBeltId([]) === '')
check('first belt later → backfill', gradeSource(null), gradeSource(null) === 'backfill')
check('belt changed → manual', gradeSource('white'), gradeSource('white') === 'manual')
check('grading on only when true', [gradingOn({ grading_enabled: true }), gradingOn({}), gradingOn(null)],
  gradingOn({ grading_enabled: true }) && !gradingOn({}) && !gradingOn(null) && !gradingOn({ grading_enabled: false }))
check('dates: 2026-03-01 ok, 2026-02-30 / 1-3-2026 / "" refused', '',
  validIsoDate('2026-03-01') && !validIsoDate('2026-02-30') && !validIsoDate('1-3-2026') && !validIsoDate(''))

// Phase 2, PR A: chips + history
check('chip: White', beltChipText(ladder[1]), beltChipText(ladder[1]) === 'White')
check('chip: 8 kyu', beltChipText(ladder[2]), beltChipText(ladder[2]) === '8 kyu')
check('belts by id', Object.keys(beltsById(ladder)).sort(), beltsById(ladder).yellow?.belt_name === 'Yellow' && Object.keys(beltsById(ladder)).length === 4)
check('light: white #FFF / yellow #FACC15', [isLightBelt('#FFF'), isLightBelt('#FACC15')], isLightBelt('#FFF') && isLightBelt('#ffffff') && isLightBelt('#FACC15'))
check('dark: brown / blue / black', [isLightBelt('#78350F'), isLightBelt('#1D4ED8'), isLightBelt('#000000')],
  !isLightBelt('#78350F') && !isLightBelt('#1D4ED8') && !isLightBelt('#000000'))
check('bad colour → treated as light (ring)', isLightBelt('nope'), isLightBelt('nope') && isLightBelt(null))
const labels = ['joined', 'backfill', 'manual', 'exam', 'other'].map(gradeSourceLabel)
check('source labels', labels, labels.join('|') === 'Joined|Entered later|Changed|Exam|')
const hist = sortGradeHistory([
  { id: 'a', achieved_on: '2026-01-05', created_at: '2026-11-10T10:00:00Z' },
  { id: 'b', achieved_on: '2026-04-05', created_at: '2026-11-10T10:05:00Z' },
  { id: 'c', achieved_on: null, created_at: '2026-11-11T09:00:00Z' },
  { id: 'd', achieved_on: '2026-04-05', created_at: '2026-11-10T11:00:00Z' },
])
check('history newest first (unknown date = saved day)', hist.map(h => h.id), hist.map(h => h.id).join() === 'c,d,b,a')

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

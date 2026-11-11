// Prints the belt rules (lib/belts.ts) for sample inputs, to read the results. Fails (exit 1) if a rule gives the wrong answer.
//   npx tsc scripts/check-belts.ts --outDir /tmp/cb --module commonjs --target es2020 --skipLibCheck && node /tmp/cb/scripts/check-belts.js

import { type BeltRank, beltLabel, beltOptions, defaultBeltId, gradeSource, gradingOn, ordinal, validIsoDate,
  beltsById, beltChipText, isLightBelt, gradeSourceLabel, sortGradeHistory,
  nextBelt, daysBetween, eligibility, toGoText, notEligibleText, splitExams, examStatusLabel, examDetailsChanged, attendanceShare,
  beltFee, feeSummary } from '../lib/belts'

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

// Phase 2, PR B: next belt, eligibility (30-day months, to the exam date), exams list, attendance share
const full: BeltRank[] = [
  { id: 'w', rank_order: 0, belt_name: 'White', kyu: null, color_hex: '#FFFFFF', is_active: true, min_months_from_previous: null },
  { id: 'y', rank_order: 1, belt_name: 'Yellow', kyu: 8, color_hex: '#FACC15', is_active: true, min_months_from_previous: 3 },
  { id: 'o', rank_order: 2, belt_name: 'Orange', kyu: 7, color_hex: '#F97316', is_active: false, min_months_from_previous: 3 },
  { id: 'g', rank_order: 3, belt_name: 'Green', kyu: 6, color_hex: '#16A34A', is_active: true, min_months_from_previous: 3 },
  { id: 'b2', rank_order: 7, belt_name: 'Brown', kyu: 2, color_hex: '#78350F', is_active: true, min_months_from_previous: 6 },
]
check('next after White = Yellow', nextBelt(full, 'w')?.id, nextBelt(full, 'w')?.id === 'y')
check('next skips an inactive belt (Orange off)', nextBelt(full, 'y')?.id, nextBelt(full, 'y')?.id === 'g')
check('top belt → none', nextBelt(full, 'b2'), nextBelt(full, 'b2') === null)
check('no belt → none', nextBelt(full, null), nextBelt(full, null) === null)
check('daysBetween 1 Jan → 1 Apr 2026 = 90', daysBetween('2026-01-01', '2026-04-01'), daysBetween('2026-01-01', '2026-04-01') === 90)
check('daysBetween across a DST-free UTC math', daysBetween('2026-03-01', '2026-02-27'), daysBetween('2026-03-01', '2026-02-27') === -2)
const el = (cur: string | null, since: string | null, exam: string) => eligibility({ ranks: full, currentRankId: cur, achievedOn: since, examDate: exam })
check('90 days on White by the exam → eligible', el('w', '2026-01-01', '2026-04-01').kind, el('w', '2026-01-01', '2026-04-01').kind === 'eligible')
const e89 = el('w', '2026-01-02', '2026-04-01')
check('89 days → not yet, 1 day to go', e89, e89.kind === 'not-yet' && e89.daysToGo === 1 && notEligibleText(e89) === '1 day to go')
const e40 = el('w', '2026-03-22', '2026-04-01')
check('10 days in → "3 mo to go" (80 days, rounded up)', notEligibleText(e40), notEligibleText(e40) === '3 mo to go')
const eMiss = el('w', null, '2026-04-01')
check('belt date missing → eligible with a warning', eMiss, eMiss.kind === 'eligible' && eMiss.dateMissing)
check('no belt → set it first', notEligibleText(el(null, null, '2026-04-01')), notEligibleText(el(null, null, '2026-04-01')) === 'Set the belt on their profile first')
check('top belt → Highest belt', notEligibleText(el('b2', '2020-01-01', '2026-04-01')), notEligibleText(el('b2', '2020-01-01', '2026-04-01')) === 'Highest belt')
const eG = el('y', '2026-01-01', '2026-04-01')
check('Yellow → Green (Orange off), uses Green\'s wait', eG, eG.kind === 'eligible' && eG.to.id === 'g')
check('to-go texts', [toGoText(1), toGoText(12), toGoText(30), toGoText(31)], [toGoText(1), toGoText(12), toGoText(30), toGoText(31)].join('|') === '1 day to go|12 days to go|1 mo to go|2 mo to go')

const exams = [
  { id: 'a', exam_date: '2026-11-20', status: 'scheduled' }, { id: 'b', exam_date: '2026-12-05', status: 'scheduled' },
  { id: 'c', exam_date: '2026-11-01', status: 'completed' }, { id: 'd', exam_date: '2026-11-25', status: 'cancelled' },
  { id: 'e', exam_date: '2026-11-08', status: 'scheduled' },
]
const sp = splitExams(exams, '2026-11-11')
check('upcoming by date; past newest first', [sp.upcoming.map(x => x.id), sp.past.map(x => x.id)],
  sp.upcoming.map(x => x.id).join() === 'a,b' && sp.past.map(x => x.id).join() === 'd,e,c')
check('status labels', exams.map(x => examStatusLabel(x, '2026-11-11')),
  exams.map(x => examStatusLabel(x, '2026-11-11')).join('|') === 'Scheduled|Scheduled|Completed|Cancelled|Results due')
const ex = { exam_date: '2026-11-20', exam_time: '09:00:00', venue: 'Kokapet' }
check('details changed: same time as 09:00 / venue spaces → no', examDetailsChanged(ex, { ...ex, exam_time: '09:00', venue: ' Kokapet ' }),
  !examDetailsChanged(ex, { ...ex, exam_time: '09:00', venue: ' Kokapet ' }))
check('details changed: date / time / venue → yes', '', examDetailsChanged(ex, { ...ex, exam_date: '2026-11-21' })
  && examDetailsChanged(ex, { ...ex, exam_time: '10:00' }) && examDetailsChanged(ex, { ...ex, venue: 'Gachibowli' }))
// Mon/Wed/Fri batch, 2–15 Nov 2026 (2 Nov is a Monday): 6 classes; came on 4 of them (+ a duplicate, + one before the start)
const share = attendanceShare({ attended: ['2026-11-02', '2026-11-04', '2026-11-04', '2026-11-09', '2026-11-13', '2026-10-30'],
  homeDays: ['Mon', 'Wed', 'Fri'], from: ['2026-11-02', null, '2026-10-01'], until: '2026-11-15' })
check('attendance 4 of 6 = 67%', share, share.attended === 4 && share.scheduled === 6 && share.pct === 67)
const noHome = attendanceShare({ attended: ['2026-11-02'], homeDays: null, from: ['2026-11-01'], until: '2026-11-15' })
check('no home batch → count only, no %', noHome, noHome.attended === 1 && noHome.pct === null)

// Fees per belt: Brown belts cost more, the rest = the exam fee
const feeExam = { fee_amount: 500, belt_fees: { b2: 800 } }
check('belt fee: own (Brown 2nd kyu 800)', beltFee(feeExam, 'b2'), beltFee(feeExam, 'b2') === 800)
check('belt fee: else exam fee (500)', beltFee(feeExam, 'y'), beltFee(feeExam, 'y') === 500)
check('belt fee: none at all → null', beltFee({ fee_amount: null, belt_fees: null }, 'y'), beltFee({ fee_amount: null, belt_fees: null }, 'y') === null)
check('belt fee: before the SQL (no belt_fees) → exam fee', beltFee({ fee_amount: 300 }, 'y'), beltFee({ fee_amount: 300 }, 'y') === 300)
const money = (n: number) => `₹${n}`
check('fee summary', feeSummary(feeExam, full, money), feeSummary(feeExam, full, money) === '₹500 · Brown – 2nd kyu ₹800')
check('fee summary: no fee', feeSummary({ fee_amount: null }, full, money), feeSummary({ fee_amount: null }, full, money) === 'No fee')

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed')
if (failed) process.exit(1)

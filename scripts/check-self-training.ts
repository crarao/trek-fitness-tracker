// Checks the self-training plan rules (lib/self-training.ts). Exits with 1 on a failed check.
//   npx tsc scripts/check-self-training.ts --outDir /tmp/cst --module commonjs --target es2020 --skipLibCheck && node /tmp/cst/scripts/check-self-training.js

import { expandOwnPlans, ownPlanOn, realPlanId, mondayOf, isPlanCopy } from '../lib/self-training'
import { planAdherence } from '../lib/adherence'
import { summarizeMonth } from '../lib/monthly-report'
import { monthReview, plateauLine, listText } from '../lib/review-report'
import type { ProgressLog } from '../lib/progress'
import type { PlanJson } from '../lib/plan-structure'
import { isSelfTraining, isMembershipOnly, trainingTypeOf, trainingFields, selfTrainingProblem, GYM_DEFAULTS } from '../lib/clientSettings'

let failed = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`)
}

const ME = 'member-1'
const plan = (id: string, week: string, by: string | null, json = true) => ({
  id, client_id: ME, week_start: week, created_by: by, plan_details: 'Mon · Push\nWed · Legs\nFri · Pull',
  plan_json: json ? {
    version: 1, note: '', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({
      day: d, rest: !['Mon', 'Wed', 'Fri'].includes(d), focus: '', exercises: ['Mon', 'Wed', 'Fri'].includes(d) ? [{ name: 'Squat', sets: '3', reps: '5', rest: '', note: '' }] : [],
    })),
  } : null,
})
const sess = (date: string, planId: string | null, day: string | null) => ({ session_date: date, weekly_plan_id: planId, plan_day: day, client_id: ME })

eq('mondayOf (Thu 19 Nov 2026)', mondayOf('2026-11-19'), '2026-11-16')

// Built on Mon 2 Nov; edited on Wed 18 Nov (saved from Mon 16 Nov)
const p1 = plan('p1', '2026-11-02', ME)
const p2 = plan('p2', '2026-11-16', ME)
const gym = plan('g1', '2026-10-26', 'coach-1')
const plans = [gym, p1, p2]

eq('plan in effect on 10 Nov = p1 (repeats)', ownPlanOn(plans, ME, '2026-11-10')?.id, 'p1')
eq('plan in effect on 19 Nov = p2 (edited)', ownPlanOn(plans, ME, '2026-11-19')?.id, 'p2')
eq('none before the first own plan', ownPlanOn(plans, ME, '2026-10-28'), null)

const sessions = [
  sess('2026-11-02', 'p1', 'Mon'), sess('2026-11-04', 'p1', 'Wed'),   // week 1 of p1
  sess('2026-11-09', 'p1', 'Mon'),                                    // week 2 of p1 (a copy)
  sess('2026-11-16', 'p1', 'Mon'),                                    // logged on p1 on Monday, edited Wed → p2's week
  sess('2026-11-18', 'p2', 'Wed'),
  sess('2026-10-27', 'g1', 'Tue'),                                    // the gym's plan: untouched
]
const out = expandOwnPlans(plans, sessions, ME, '2026-11-19')
eq('weeks: p1 on 2 Nov + 9 Nov copy, p2 on 16 Nov, gym plan kept', out.plans.map(p => [p.id, p.week_start]).sort(),
  [['g1', '2026-10-26'], ['p1', '2026-11-02'], ['p1@2026-11-09', '2026-11-09'], ['p2', '2026-11-16']])
eq('sessions follow their week', out.sessions.map(s => s.weekly_plan_id), ['p1', 'p1', 'p1@2026-11-09', 'p2', 'p2', 'g1'])
eq('stored id of a copy', realPlanId('p1@2026-11-09'), 'p1')
eq('copy id is marked', [isPlanCopy('p1@2026-11-09'), isPlanCopy('p1')], [true, false])

const ad = (id: string) => planAdherence(out.plans.find(p => p.id === id)!, out.sessions)
eq('week of 2 Nov: 2 of 3', ad('p1'), { planned: 3, done: 2 })
eq('week of 9 Nov (copy): 1 of 3', ad('p1@2026-11-09'), { planned: 3, done: 1 })
eq('week of 16 Nov after the edit: Mon + Wed = 2 of 3', ad('p2'), { planned: 3, done: 2 })

// Not edited for a while: copies run to today's week
const long = expandOwnPlans([p1], [], ME, '2026-11-30')
eq('one plan, four weeks', long.plans.map(p => p.week_start), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])

// Two saves in one week: the later one is that week's plan
const same = expandOwnPlans([plan('a', '2026-11-16', ME), plan('b', '2026-11-16', ME)], [], ME, '2026-11-19')
eq('two saves in a week: the later one wins', same.plans.map(p => p.id), ['b'])

// An edit in the same week: a newer row with the same Monday must win, whatever the ids (found on dev 19 Nov:
// ids are random, and the old rule picked by id)
const first = { ...plan('zzz-first', '2026-11-16', ME), created_at: '2026-11-19T06:00:00Z' }
const edited = { ...plan('aaa-edited', '2026-11-16', ME), created_at: '2026-11-19T06:25:00Z' }
eq('same-week edit: the newer save is in effect', ownPlanOn([first, edited], ME, '2026-11-19')?.id, 'aaa-edited')
eq('same-week edit: the newer save is the week\'s plan', expandOwnPlans([first, edited], [], ME, '2026-11-19').plans.map(p => p.id), ['aaa-edited'])

// A member with no own plans: nothing changes
const none = expandOwnPlans([gym], sessions, ME, '2026-11-19')
eq('no own plans: same arrays', [none.plans === undefined, none.plans.length, none.sessions === sessions], [false, 1, true])

// ---- Monthly review (lib/review-report.ts) ----
let n = 0
const log = (date: string, name: string, kg: number, reps = 10, sets = 3): ProgressLog => ({
  id: `l${++n}`, session_id: `s-${date}`, exercise_id: null, exercise_name: name, position: n, sets, reps, weight: kg, unit: 'kg',
  set_details: Array.from({ length: sets }, () => ({ kg, reps })), created_at: `${date}T10:00:00Z`, session_date: date, logged_by: ME,
})
const logs = [
  log('2026-10-20', 'Squat', 50),                                                      // before November
  log('2026-11-02', 'Squat', 52.5), log('2026-11-09', 'Squat', 55),                    // new best
  log('2026-11-03', 'Curl', 8), log('2026-11-10', 'Curl', 8), log('2026-11-17', 'Curl', 8), // stalled
]
const novSessions = ['2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10', '2026-11-17']
  .map(d => ({ session_date: d, weekly_plan_id: null, plan_day: null, duration_minutes: 40, client_id: ME }))
const summary = summarizeMonth({ plans: [], sessions: novSessions, month: '2026-11', today: '2026-11-19' })
const json = p1.plan_json as unknown as PlanJson
json.days[4].exercises = [{ name: 'Deadlift', sets: '3', reps: '5', rest: '', note: '' }]
const rv = monthReview({ logs, library: [], plan: json, summary })
eq('review: weeks of November so far', rv.weeks.map(w => [w.from, w.sessions, w.volume]),
  [['2026-11-01', 0, 0], ['2026-11-02', 2, 1815], ['2026-11-09', 2, 1890], ['2026-11-16', 1, 240]])
eq('review: new bests', rv.newBests, ['Squat'])
eq('review: stalled', rv.stalled, ['Curl'])
eq('review: in the plan, not done 2+ weeks', rv.notDone, ['Deadlift'])
eq('list text', [listText(['A']), listText(['A', 'B']), listText(['A', 'B', 'C'])], ['A', 'A and B', 'A, B and C'])
eq('plateau line', plateauLine('FitLoft', ['Curl']), 'Want help breaking your plateau on Curl? Talk to the FitLoft team on your next visit.')

// Training type (24 Nov): profiles.self_training decides once the column exists
const on = { ...GYM_DEFAULTS, self_training_enabled: true, client_login: true }
eq('self: ticked member, switch on', isSelfTraining({ client_type: 'member', self_training: true }, on), true)
eq('self: membership only', isSelfTraining({ client_type: 'member', self_training: false }, on), false)
eq('self: PT never, even if flagged', isSelfTraining({ client_type: 'pt', self_training: true }, on), false)
eq('self: switch off', isSelfTraining({ client_type: 'member', self_training: true }, GYM_DEFAULTS), false)
eq('self: before the column, every non-PT member (19 Nov rule)', isSelfTraining({ client_type: 'member' }, on), true)
eq('self: no person', isSelfTraining(null, on), false)
eq('training type', [trainingTypeOf({ client_type: 'pt' }), trainingTypeOf({ client_type: 'member', self_training: true }), trainingTypeOf({ client_type: null })], ['pt', 'self', 'member'])
eq('training fields', [trainingFields('pt', true), trainingFields('self', true), trainingFields('member', false)],
  [{ client_type: 'pt', self_training: false }, { client_type: 'member', self_training: true }, { client_type: 'member' }])
eq('membership only: unticked member', isMembershipOnly({ client_type: 'member', self_training: false }, on), true)
eq('membership only: not for self-training', isMembershipOnly({ client_type: 'member', self_training: true }, on), false)
eq('membership only: not for PT', isMembershipOnly({ client_type: 'pt', self_training: false }, on), false)
eq('membership only: switch off = never', isMembershipOnly({ client_type: 'member', self_training: false }, GYM_DEFAULTS), false)
eq('membership only: before the column = never', isMembershipOnly({ client_type: 'member' }, on), false)
eq('warning: fine', selfTrainingProblem(on, true), '')
eq('warning: switch off = none', selfTrainingProblem(GYM_DEFAULTS, false), '')
eq('warning: app + module off', selfTrainingProblem({ ...GYM_DEFAULTS, self_training_enabled: true }, false),
  "Self-training is on, but Client app and Client Training Module are off: members can't use it yet.")

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')

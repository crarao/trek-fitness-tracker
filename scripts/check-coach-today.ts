// Prints the coach home rules (ROADMAP #40, lib/coach-today.ts) for a few sample clients, to read the results.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-coach-today.ts --outDir /tmp/cct --module commonjs --target es2020 --skipLibCheck && node /tmp/cct/scripts/check-coach-today.js

import { todayRows, sortRows, beforeYouStart, isCovering, type CoachClient, type CoachPlan, type CoachSession } from '../lib/coach-today'

const today = '2026-10-29' // a Thursday
const weekStart = '2026-10-26' // Monday

const ravi = { id: 'coach-ravi', full_name: 'Ravi Kumar' }
const meena = { id: 'coach-meena', full_name: 'Meena Iyer' }
const coaches = [ravi, meena]

const client = (id: string, full_name: string, primary_coach_id: string | null = null, extra: Partial<CoachClient> = {}): CoachClient =>
  ({ id, full_name, primary_coach_id, client_type: 'pt', archived_at: null, ...extra })

// Structured plan: Thu is a workout day unless `restThu`
const plan = (client_id: string, workout_time: string | null, restThu = false): CoachPlan => ({
  id: `plan-${client_id}`,
  client_id,
  week_start: weekStart,
  workout_time,
  plan_details: '',
  plan_json: {
    days: [
      { day: 'Mon', focus: 'Legs', rest: false, exercises: [{ name: 'Squat', sets: '3', reps: '10', rest: '', note: '' }] },
      { day: 'Thu', focus: restThu ? '' : 'Upper Body Push', rest: restThu, exercises: restThu ? [] : Array.from({ length: 7 }, (_, i) => ({ name: `Ex ${i + 1}`, sets: '3', reps: '10', rest: '', note: '' })) },
    ],
  },
})

const session = (id: string, client_id: string, session_date: string, logged_by: string | null, extra: Partial<CoachSession> = {}): CoachSession =>
  ({ id, client_id, session_date, duration_minutes: 45, weekly_plan_id: null, plan_day: null, logged_by, notes: null, ...extra })

const dayText = (d: ReturnType<typeof todayRows>[number]['todayDay']) => (typeof d === 'string' ? d : d.label)

console.log('1. sortRows (today Thu 29 Oct)')
const anil = client('c-anil', 'Anil')
const bina = client('c-bina', 'Bina')
const chetan = client('c-chetan', 'Chetan')
const divya = client('c-divya', 'Divya')
const sortPlans = [plan(anil.id, '6:00 pm'), plan(bina.id, '7:00 am'), plan(chetan.id, null), plan(divya.id, '6:00 am', true)]
for (const r of sortRows(todayRows([anil, bina, chetan, divya], sortPlans, [], coaches, ravi.id, today))) {
  console.log(`   ${r.client.full_name.padEnd(8)} ${dayText(r.todayDay).padEnd(22)} ${r.workoutTime ?? '(no time)'}`)
}
console.log('   expect: Bina 7:00 am, Anil 6:00 pm, Chetan (no time), Divya rest')

console.log('\n2. todayRows: done by a coach / by the client / not yet')
const esha = client('c-esha', 'Esha', ravi.id)
const farah = client('c-farah', 'Farah', meena.id)
const gopal = client('c-gopal', 'Gopal')
const doneSessions = [
  session('s1', esha.id, today, meena.id, { weekly_plan_id: `plan-${esha.id}`, plan_day: 'Thu · Upper Body Push', exercises_done: { done: ['Ex 1', 'Ex 2', 'Ex 3', 'Ex 4', 'Ex 5', 'Ex 6'], total: 7 }, duration_minutes: 50 }),
  session('s2', farah.id, today, farah.id, { duration_minutes: 30 }),
  session('s3', gopal.id, '2026-10-27', ravi.id),
]
const rows = todayRows([esha, farah, gopal], [plan(esha.id, '6:00 pm'), plan(farah.id, null), plan(gopal.id, null)], doneSessions, coaches, ravi.id, today)
for (const r of rows) {
  const done = r.doneToday ? `✓ by ${r.doneToday.by}${r.doneToday.exercises ? ` · ${r.doneToday.exercises}` : ''} · ${r.doneToday.minutes} min` : 'Not yet'
  console.log(`   ${r.client.full_name.padEnd(6)} primary: ${(r.primaryCoach ?? 'none').padEnd(5)} mine: ${String(r.isMine).padEnd(5)} ${done.padEnd(32)} last: ${r.lastSessionDate}`)
}
console.log('   expect: Esha ✓ by Coach Meena · 6/7 (primary You, mine), Farah ✓ by client, Gopal Not yet (last 27 Oct)')

console.log('\n3. beforeYouStart')
const hari = client('c-hari', 'Hari', ravi.id, { goal: 'Lose 5 kg', medical_conditions: 'Left knee pain' })
const names = { [ravi.id]: ravi.full_name, [meena.id]: meena.full_name }
const five = [
  session('h1', hari.id, '2026-10-20', ravi.id),
  session('h2', hari.id, '2026-10-21', hari.id, { activity: 'run' }),
  session('h3', hari.id, '2026-10-22', ravi.id),
  session('h4', hari.id, '2026-10-24', meena.id, { plan_day: 'Sat · Legs', exercises_done: { done: ['Squat'], total: 4 }, notes: 'Went light on the knee' }),
  session('h5', hari.id, '2026-10-26', ravi.id, { plan_day: 'Mon · Legs', duration_minutes: 60 }),
]
for (const [label, list] of [['0 sessions', []], ['1 session', five.slice(0, 1)], ['5 sessions', five]] as const) {
  const b = beforeYouStart(hari, [...list], names, today)
  console.log(`   ${label}: goal "${b.goal}", medical "${b.medical}", total ${b.totalSessions}, days since last ${b.daysSinceLast}`)
  for (const s of b.lastTwo) console.log(`      ${s.date} · ${s.day ?? '-'} · ${s.exercises ?? '-'} · ${s.minutes} min · ${s.notes ?? '-'} · by ${s.by}${s.covering ? ' (covering)' : ''}`)
}
console.log('   expect: 0 → total 0, null; 1 → 20 Oct by Coach Ravi, 9 days; 5 → 26 Oct (Mon · Legs, Ravi) and 24 Oct (Sat · Legs, 1/4, Meena, covering), 3 days')

console.log('\n4. isCovering (client Hari, primary coach Ravi)')
const noPrimary = client('c-isha', 'Isha')
console.log('   Ravi (primary) logs     →', isCovering(session('x1', hari.id, today, ravi.id), hari), '(expect false)')
console.log('   Meena logs              →', isCovering(session('x2', hari.id, today, meena.id), hari), '(expect true)')
console.log('   Ravi logs, no primary   →', isCovering(session('x3', noPrimary.id, today, ravi.id), noPrimary), '(expect true)')
console.log('   client logs             →', isCovering(session('x4', hari.id, today, hari.id), hari), '(expect false)')
console.log('   client logs (no logger) →', isCovering(session('x5', hari.id, today, null), hari), '(expect false)')
console.log('   viewer Meena            →', isCovering(meena.id, hari), '(expect true)')

// Prints the leads rules (ROADMAP #52) for a few sample leads, to read the results.
// No test framework needed (uses the TypeScript compiler already in devDependencies):
//   npx tsc scripts/check-leads.ts --outDir /tmp/cl --module commonjs --target es2020 --skipLibCheck && node /tmp/cl/scripts/check-leads.js

import { followUpState, leadSummary, leadMessage, normalizePhone, type LeadStatus } from '../lib/leads'

const today = '2026-10-29' // a Thursday

// Timestamps without a zone are read as local time, so the results don't depend on where this runs
const lead = (status: LeadStatus, follow_up_date: string | null, created_at = '2026-10-20T10:00:00', updated_at = created_at) =>
  ({ name: 'Rohan Mehta', status, follow_up_date, created_at, updated_at })

console.log('1. Follow-up state (today 29 Oct)')
const states: [string, ReturnType<typeof lead>][] = [
  ['new, follow-up 27 Oct', lead('new', '2026-10-27')],
  ['trial, follow-up 29 Oct', lead('trial', '2026-10-29')],
  ['new, follow-up 2 Nov', lead('new', '2026-11-02')],
  ['new, no follow-up', lead('new', null)],
  ['joined, follow-up 27 Oct (closed)', lead('joined', '2026-10-27')],
  ['lost, follow-up 29 Oct (closed)', lead('lost', '2026-10-29')],
]
for (const [label, l] of states) console.log(`   ${label.padEnd(36)} → ${followUpState(l, today)}`)

console.log('\n2. Summary numbers')
// A lead added late on Sunday 1 Nov: in the week of Mon 26 Oct, not in the week of Mon 2 Nov
const sundayLead = lead('new', null, '2026-11-01T23:30:00')
const mondayLead = lead('new', null, '2026-11-02T00:15:00')
console.log('   Sun 1 Nov → new this week:', leadSummary([sundayLead, mondayLead], '2026-11-01').newThisWeek, '(expect 1: only the Sunday lead)')
console.log('   Mon 2 Nov → new this week:', leadSummary([sundayLead, mondayLead], '2026-11-02').newThisWeek, '(expect 1: only the Monday lead)')

const october = [
  lead('new', '2026-10-27'),                                                // overdue
  lead('trial', '2026-10-29'),                                              // due today
  lead('new', '2026-10-30', '2026-10-27T09:00:00'),                         // upcoming, added this week
  lead('joined', null, '2026-10-10T09:00:00', '2026-10-15T12:00:00'),       // joined this month
  lead('joined', null, '2026-10-12T09:00:00', '2026-10-28T12:00:00'),       // joined this month
  lead('lost', null, '2026-10-05T09:00:00', '2026-10-21T12:00:00'),         // lost this month
  lead('lost', null, '2026-09-01T09:00:00', '2026-09-20T12:00:00'),         // lost last month: not counted
]
console.log('   29 Oct, sample month:', JSON.stringify(leadSummary(october, today)))
console.log('     expect dueToday 1, overdue 1, newThisWeek 1, joined 2, lost 1, conversion 67%')
const quietMonth = [lead('new', '2026-11-03', '2026-10-01T09:00:00'), lead('lost', null, '2026-09-01T09:00:00', '2026-09-20T12:00:00')]
console.log('   29 Oct, 0 joined / 0 lost:', JSON.stringify(leadSummary(quietMonth, today)), '(expect conversionPct null)')

console.log('\n3. WhatsApp wording')
for (const businessType of ['gym', 'martial_arts']) {
  for (const status of ['new', 'trial', 'lost'] as LeadStatus[]) {
    console.log(`   ${businessType} · ${status}: ${leadMessage({ name: 'Rohan Mehta', status }, 'Iron Gym', businessType)}`)
  }
}

console.log('\n4. Phone numbers (India)')
for (const raw of ['+91 98490 11234', '098490 11234', '9849011234']) {
  console.log(`   ${JSON.stringify(raw).padEnd(18)} → ${normalizePhone(raw, 'IN')}`)
}

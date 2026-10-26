// Super admin dashboard: is each gym using CoachBoard, and what should Anand do about it?
// "Work" = staff doing real things in the app: adding members, recording memberships/renewals,
// assigning plans. Health from the most recent work:
//   active  = within 7 days · quiet = 8–15 days · dormant = more than 15 days (or never)
// Test companies (companies.is_test) are left out by the caller.

import { daysUntil } from './locale'

export type UsageCompany = {
  id: string; name: string; phone?: string | null; created_at: string
  is_active: boolean; is_trial: boolean; trial_end: string | null
  client_limit: number | null; pt_limit: number | null; is_test?: boolean | null
}
export type UsageClient = { id: string; company_id: string; created_at: string; archived_at: string | null; client_type: string | null }
export type UsageMembership = { profile_id: string; company_id: string; created_at?: string | null }
export type UsagePlan = { company_id: string; created_at: string }

export type Health = 'active' | 'quiet' | 'dormant'

export type CompanyUsage = {
  company: UsageCompany
  members: number            // active (not archived) clients
  pt: number
  membersAdded30: number
  renewals30: number         // membership records added in 30 days beyond each new member's first
  plans30: number
  lastWorkDays: number | null // days since the last piece of work; null = never
  health: Health
  daysLeft: number | null    // subscription / trial days left incl. today; ≤ 0 = ended
  status: 'trial' | 'paid'
  ageDays: number            // days since the company was created
}

const DAY = 86400000
const daysSince = (iso: string, now: number) => Math.floor((now - new Date(iso).getTime()) / DAY)

export function healthFor(lastWorkDays: number | null): Health {
  if (lastWorkDays == null || lastWorkDays > 15) return 'dormant'
  return lastWorkDays <= 7 ? 'active' : 'quiet'
}

export function companyUsage(
  company: UsageCompany,
  clients: UsageClient[],
  memberships: UsageMembership[],
  plans: UsagePlan[],
  now = Date.now(),
): CompanyUsage {
  const mine = clients.filter(c => c.company_id === company.id)
  const active = mine.filter(c => !c.archived_at)
  const mems = memberships.filter(m => m.company_id === company.id)
  const myPlans = plans.filter(p => p.company_id === company.id)
  const within30 = (iso?: string | null) => !!iso && daysSince(iso, now) <= 30

  const membersAdded30 = mine.filter(c => within30(c.created_at)).length
  const memberships30 = mems.filter(m => within30(m.created_at)).length
  const dates = [
    ...mine.map(c => c.created_at),
    ...mems.map(m => m.created_at).filter((d): d is string => !!d),
    ...myPlans.map(p => p.created_at),
  ]
  const latest = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null
  const lastWorkDays = latest ? Math.max(0, daysSince(latest, now)) : null
  const until = daysUntil(company.trial_end)

  return {
    company,
    members: active.length,
    pt: active.filter(c => c.client_type === 'pt').length,
    membersAdded30,
    renewals30: Math.max(0, memberships30 - membersAdded30),
    plans30: myPlans.filter(p => within30(p.created_at)).length,
    lastWorkDays,
    health: healthFor(lastWorkDays),
    daysLeft: until == null ? null : until + 1,
    status: company.is_trial ? 'trial' : 'paid',
    ageDays: Math.max(0, daysSince(company.created_at, now)),
  }
}

export type ActionKind = 'convert' | 'lapse' | 'collect' | 'deactivate' | 'check-in' | 'limit' | 'onboard' | 'ai-cost'

export type Action = {
  kind: ActionKind
  usage: CompanyUsage
  reason: string      // "Trial ends in 5 days · 12 members added"
  action: string      // "Convert to paid"
  tone: 'good' | 'warn' | 'bad'
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

// What to do about one gym, most urgent first. Deactivated gyms need nothing.
export function actionsFor(u: CompanyUsage): Action[] {
  const out: Action[] = []
  const c = u.company
  if (!c.is_active) return out
  const using = u.health !== 'dormant'
  const work = [
    u.membersAdded30 ? plural(u.membersAdded30, 'member') + ' added' : '',
    u.renewals30 ? plural(u.renewals30, 'renewal') : '',
    u.plans30 ? plural(u.plans30, 'plan') + ' assigned' : '',
  ].filter(Boolean).join(' · ') || 'nothing added in 30 days'

  if (u.daysLeft != null && u.daysLeft <= 0) {
    const ago = 1 - u.daysLeft
    const what = u.status === 'trial' ? 'Trial' : 'Subscription'
    out.push(using
      ? { kind: 'collect', usage: u, tone: 'warn', action: 'Collect payment', reason: `${what} ended ${plural(ago, 'day')} ago · still in use (${work})` }
      : { kind: 'deactivate', usage: u, tone: 'bad', action: 'Deactivate', reason: `${what} ended ${plural(ago, 'day')} ago · not in use` })
  } else if (u.status === 'trial' && u.daysLeft != null && u.daysLeft <= 14) {
    out.push(using
      ? { kind: 'convert', usage: u, tone: 'good', action: 'Convert to paid', reason: `Trial ends in ${plural(u.daysLeft, 'day')} · ${work}` }
      : { kind: 'lapse', usage: u, tone: 'bad', action: 'Call, or let it lapse', reason: `Trial ends in ${plural(u.daysLeft, 'day')} · not in use` })
  } else if (u.status === 'paid' && !using) {
    out.push({ kind: 'check-in', usage: u, tone: 'bad', action: 'Check in',
      reason: u.lastWorkDays == null ? 'Paid · no activity yet' : `Paid · no activity in ${plural(u.lastWorkDays, 'day')}` })
  }

  const nearClients = c.client_limit ? u.members / c.client_limit >= 0.8 : false
  const nearPt = c.pt_limit ? u.pt / c.pt_limit >= 0.8 : false
  if (nearClients || nearPt) {
    out.push({ kind: 'limit', usage: u, tone: 'good', action: 'Raise limit / upgrade',
      reason: [nearClients ? `${u.members} / ${c.client_limit} clients` : '', nearPt ? `${u.pt} / ${c.pt_limit} PT` : ''].filter(Boolean).join(' · ') })
  }

  if (u.ageDays <= 14 && u.members < 5) {
    out.push({ kind: 'onboard', usage: u, tone: 'warn', action: 'Help them set up',
      reason: `Joined ${u.ageDays === 0 ? 'today' : plural(u.ageDays, 'day') + ' ago'} · ${plural(u.members, 'member')} so far` })
  }
  return out
}

// Most urgent first: money and churn before growth
const ORDER: ActionKind[] = ['collect', 'convert', 'lapse', 'deactivate', 'check-in', 'ai-cost', 'onboard', 'limit']
export const sortActions = (list: Action[]) =>
  [...list].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)
    || (a.usage.daysLeft ?? 999) - (b.usage.daysLeft ?? 999))

// Companies table: least healthy first, then by most recent work
const HEALTH_RANK: Record<Health, number> = { dormant: 0, quiet: 1, active: 2 }
export const sortUsage = (list: CompanyUsage[]) =>
  [...list].sort((a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health]
    || (b.lastWorkDays ?? 9999) - (a.lastWorkDays ?? 9999))

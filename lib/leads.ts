// Leads / enquiry tracking (ROADMAP #52). Pure helpers: no Supabase, no React.
// Table: public.leads (db/2026-10-29-leads.md). A lead is never deleted: it ends as Joined or Lost.

import { type Country, parseDate } from './locale'

export type LeadStatus = 'new' | 'trial' | 'joined' | 'lost'

export type Lead = {
  id: string
  company_id: string
  name: string
  phone: string | null
  source: string | null
  interest: string | null
  status: LeadStatus
  follow_up_date: string | null     // date only, YYYY-MM-DD
  last_contacted_at: string | null  // timestamp
  lost_reason: string | null
  notes: string | null
  converted_profile_id: string | null
  created_at: string
  updated_at: string
}

export type Option = { key: string; label: string }

// Business types that get walk-ins; everything else (trek, general, online coaches) is DM-first
export const GYM_TYPES = ['gym', 'pilates', 'yoga', 'cycling', 'martial_arts']

export function isGymType(businessType: string | null | undefined): boolean {
  return GYM_TYPES.includes(businessType || '')
}

const SOURCE_LABELS: Record<string, string> = {
  walk_in: 'Walk-in', instagram: 'Instagram', referral: 'Referral',
  website: 'Website', whatsapp: 'WhatsApp', other: 'Other',
}

export function SOURCES(businessType: string | null | undefined): Option[] {
  const keys = isGymType(businessType)
    ? ['walk_in', 'instagram', 'referral', 'website', 'whatsapp', 'other']
    : ['instagram', 'whatsapp', 'referral', 'website', 'other']
  return keys.map(key => ({ key, label: SOURCE_LABELS[key] }))
}

export function sourceLabel(key: string | null | undefined): string {
  return key ? SOURCE_LABELS[key] || key : ''
}

export const INTERESTS: Option[] = [
  { key: 'membership', label: 'Membership' },
  { key: 'pt', label: 'Personal training (PT)' },
  { key: 'trial', label: 'Trial' },
  { key: 'other', label: 'Other' },
]

export function interestLabel(key: string | null | undefined): string {
  return INTERESTS.find(i => i.key === key)?.label || key || ''
}

export const LOST_REASONS = ['Price', 'Joined elsewhere', 'Not interested', 'No response', 'Other']

export function isOpen(lead: Pick<Lead, 'status'>): boolean {
  return lead.status === 'new' || lead.status === 'trial'
}

// Plain YYYY-MM-DD string compare (no Date parsing of date-only values). Closed leads: 'none'.
export function followUpState(
  lead: Pick<Lead, 'status' | 'follow_up_date'>,
  todayIso: string
): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!isOpen(lead) || !lead.follow_up_date) return 'none'
  const d = lead.follow_up_date.slice(0, 10)
  if (d < todayIso) return 'overdue'
  if (d === todayIso) return 'today'
  return 'upcoming'
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

export function leadMessage(
  lead: Pick<Lead, 'name' | 'status'>,
  companyName: string,
  businessType: string | null | undefined
): string {
  const emoji = businessType === 'martial_arts' ? '🥋' : '💪'
  const hi = `Hi ${firstName(lead.name)}`
  switch (lead.status) {
    case 'trial':
      return `${hi}, how did your trial at ${companyName} go? Happy to help you pick a plan that suits you. ${emoji}`
    case 'lost':
      return `${hi}, hope you're doing well! We'd love to have you at ${companyName} whenever you're ready. ${emoji}`
    case 'joined':
      return `${hi}, welcome to ${companyName}! ${emoji}`
    default:
      return `${hi}, thanks for your interest in ${companyName}! Would you like to come in for a trial session this week? ${emoji}`
  }
}

// A timestamp ("2026-10-29T18:30:00+00:00") as this device's local calendar day
export function localDayOf(timestamp: string): string {
  const d = new Date(timestamp)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Monday of the week containing a YYYY-MM-DD day (local calendar, Monday–Sunday weeks)
export function mondayOf(dayIso: string): string {
  const d = parseDate(dayIso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(dayIso: string, n: number): string {
  const d = parseDate(dayIso)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type LeadSummary = {
  dueToday: number         // open leads with follow-up today
  overdue: number          // open leads with follow-up before today
  newThisWeek: number      // added Monday–Sunday of this week
  joinedThisMonth: number  // marked joined this calendar month (by updated_at)
  lostThisMonth: number
  conversionPct: number | null  // joined ÷ (joined + lost) this month; null when both are 0
}

export function leadSummary(
  leads: Pick<Lead, 'status' | 'follow_up_date' | 'created_at' | 'updated_at'>[],
  todayIso: string
): LeadSummary {
  const weekStart = mondayOf(todayIso)
  const weekEnd = addDaysIso(weekStart, 6)
  const month = todayIso.slice(0, 7)
  let dueToday = 0, overdue = 0, newThisWeek = 0, joinedThisMonth = 0, lostThisMonth = 0
  for (const l of leads) {
    const state = followUpState(l, todayIso)
    if (state === 'today') dueToday++
    if (state === 'overdue') overdue++
    const created = localDayOf(l.created_at)
    if (created >= weekStart && created <= weekEnd) newThisWeek++
    const closedThisMonth = localDayOf(l.updated_at).slice(0, 7) === month
    if (closedThisMonth && l.status === 'joined') joinedThisMonth++
    if (closedThisMonth && l.status === 'lost') lostThisMonth++
  }
  const closed = joinedThisMonth + lostThisMonth
  return {
    dueToday, overdue, newThisWeek, joinedThisMonth, lostThisMonth,
    conversionPct: closed === 0 ? null : Math.round((joinedThisMonth / closed) * 100),
  }
}

// Digits only. India: "+91 98490 11234" / "098490 11234" → "9849011234".
// US: a leading 1 on an 11-digit number is the country code (wa.me adds it back).
export function normalizePhone(raw: string | null | undefined, country: Country): string {
  const digits = (raw || '').replace(/\D/g, '')
  if (country === 'IN' && digits.length > 10 && (digits.startsWith('91') || digits.startsWith('0'))) {
    return digits.slice(-10)
  }
  if (country === 'US' && digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

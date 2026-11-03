// Parent / guardian of a client (Dojo Build 1, ROADMAP #53; columns in db/2026-11-03-guardian.md).
// Pure helpers, no Supabase calls, so the wording can be checked with sample data (scripts/check-guardian.ts).
//
// One recipient rule for every WhatsApp message about a client: the parent when a valid parent phone is set,
// otherwise the client. Progress shares (lib/progress-share.ts) and membership reminders (owner dashboard) both use
// pickRecipient; each keeps its own phone reader, so neither message changes for clients without a parent.

import { type Country, formatDate } from './locale'
import { splitE164, waDigits as toWaDigits } from './phone'

export type GuardianFields = {
  full_name?: string | null
  phone?: string | null
  // Columns may not exist yet (before the SQL): then undefined and everything goes to the client, as today
  guardian_name?: string | null
  guardian_phone?: string | null
  guardian_relation?: string | null
}

export const GUARDIAN_RELATIONS = ['Mother', 'Father', 'Guardian'] as const

// The parent when their phone reads as a number (toPhone gives non-null), otherwise the client's own phone
export function pickRecipient<T>(p: GuardianFields, toPhone: (raw: string | null | undefined) => T | null): { phone: T | null; toParent: boolean } {
  const parentPhone = toPhone(p.guardian_phone)
  if (parentPhone != null) return { phone: parentPhone, toParent: true }
  return { phone: toPhone(p.phone), toParent: false }
}

// A parent phone is set and is a valid number of a supported country
export function hasGuardian(p: GuardianFields, country: string | null | undefined = 'IN'): boolean {
  return !!splitE164(p.guardian_phone, country)
}

// Who a membership reminder goes to on WhatsApp. waDigits null = no WhatsApp number (the button opens the client).
// greetName: the parent's first name for a parent, else the client's first word exactly as the dashboard always did.
export function reminderRecipient(p: GuardianFields, country: string | null | undefined): { waDigits: string | null; greetName: string; toParent: boolean } {
  const to = pickRecipient(p, raw => toWaDigits(raw, country))
  return {
    waDigits: to.phone,
    greetName: to.toParent ? (p.guardian_name || '').trim().split(/\s+/)[0] || '' : (p.full_name || '').split(' ')[0],
    toParent: to.toParent,
  }
}

// WhatsApp text for the Remind / Follow Up button. Without a parent: the wording the dashboard always used
// (only the emoji follows the business type: 🥋 for martial arts, 💪 otherwise).
export function reminderText(opts: {
  status: 'expiring' | 'expired'
  memberFirst: string
  parentFirst?: string | null
  companyName: string
  endDate: string | null | undefined   // 'YYYY-MM-DD' (latest membership)
  businessType?: string | null
  toParent: boolean
  country: Country
}): string {
  const emoji = opts.businessType === 'martial_arts' ? '🥋' : '💪'
  const date = opts.endDate ? formatDate(opts.endDate, opts.country, 'dayMonth') : ''
  const { memberFirst, companyName } = opts
  if (opts.toParent) {
    const parent = (opts.parentFirst || '').trim() || 'there'
    return opts.status === 'expiring'
      ? `Hi ${parent}, ${memberFirst}'s fees at ${companyName} are due on ${date}. Please renew to continue classes. ${emoji}`
      : `Hi ${parent}, ${memberFirst}'s membership at ${companyName} has lapsed. We'd love to have them back in class — reach out to renew! ${emoji}`
  }
  return opts.status === 'expiring'
    ? `Hi ${memberFirst}, your membership at ${companyName} expires on ${date}. Renew now to keep going! ${emoji}`
    : `Hi ${memberFirst}, your membership at ${companyName} has expired. We'd love to have you back — reach out to renew! ${emoji}`
}

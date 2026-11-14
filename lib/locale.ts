// Country-driven formatting and rules. Set once per company (companies.country).
// Every screen should use these helpers instead of hard-coding 'en-IN' / 'en'.

import { PHONE_COUNTRIES } from './phone'
import type { Currency } from './currency'

// companies.country = the gym's home country; profiles.country = a client's own country (multi-country gyms)
export type Country = 'IN' | 'AE' | 'US' | 'CA'

export const COUNTRIES: { code: Country; label: string; currency: Currency }[] = [
  { code: 'IN', label: 'India', currency: 'INR' },
  { code: 'AE', label: 'UAE', currency: 'AED' },
  { code: 'US', label: 'United States', currency: 'USD' },
  { code: 'CA', label: 'Canada', currency: 'CAD' },
]

// Anything unknown or empty is treated as India (the original default).
export function normalizeCountry(value: string | null | undefined): Country {
  return value === 'AE' || value === 'US' || value === 'CA' ? value : 'IN'
}

// The currency a country's gym starts with (super admin can pick another base currency)
export function currencyForCountry(country: Country): Currency {
  return COUNTRIES.find(c => c.code === country)?.currency ?? 'INR'
}

const LOCALE: Record<Country, string> = { IN: 'en-IN', AE: 'en-AE', US: 'en-US', CA: 'en-CA' }

// Date-only values from Postgres ("2026-10-26") are calendar days, not moments in
// time. `new Date("2026-10-26")` treats them as UTC midnight, which shows the
// previous day in timezones behind UTC (the US). Parse them as local dates.
export function parseDate(value: string | Date): Date {
  if (value instanceof Date) return value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

// Today on this device as YYYY-MM-DD (local, not UTC: UTC is a day behind before 5:30 am in India)
export function localDateIso(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Whole days from today until a date-only value: 0 = today is the last day, -1 = ended yesterday.
// null when there is no date.
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const end = parseDate(value.slice(0, 10))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((end.getTime() - today.getTime()) / 86400000)
}

export type DateStyle =
  | 'dayMonth'   // IN: 24 Oct          US: Oct 24
  | 'medium'     // IN: 24 Oct 2026     US: Oct 24, 2026
  | 'long'       // IN: 24 October 2026 US: October 24, 2026
  | 'weekday'    // IN: Sat, 24 Oct     US: Sat, Oct 24
  | 'monthYear'  // Oct 2026
  | 'month'      // Oct
  | 'monthLong'  // October

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  dayMonth: { day: 'numeric', month: 'short' },
  medium: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', month: 'long', year: 'numeric' },
  weekday: { weekday: 'short', day: 'numeric', month: 'short' },
  monthYear: { month: 'short', year: 'numeric' },
  month: { month: 'short' },
  monthLong: { month: 'long' },
}

// country === null means the company hasn't loaded yet: show nothing rather
// than flashing the wrong format.
export function formatDate(
  value: string | Date | null | undefined,
  country: Country | null,
  style: DateStyle = 'medium'
): string {
  if (!value || country === null) return ''
  const date = parseDate(value)
  if (isNaN(date.getTime())) return ''
  return date.toLocaleDateString(LOCALE[country], STYLES[style])
}

// ---- Phone & login rules ----

// How a CLIENT logs in, by the client's country (staff: lib/phone.ts staffLogin).
// India: the 10-digit phone (stored as {phone}@getcoachboard.in, lib/phone.ts loginEmailFor).
// Everyone else (UAE, US, Canada): email; their phone is for contact only.
export function loginMethod(country: Country): 'phone' | 'email' {
  return country === 'IN' ? 'phone' : 'email'
}

// Country calling code (91, 971, 1, 1)
export function dialCode(country: Country): string {
  return PHONE_COUNTRIES[country].dial
}

export function phonePlaceholder(country: Country): string {
  if (country === 'US' || country === 'CA') return 'Phone, e.g. 555 123 4567'
  if (country === 'AE') return 'Phone, e.g. 50 123 4567'
  return 'Phone number (10 digits)'
}

// Opening of every WhatsApp message (12 Nov: one standard greeting). India: "Namaste Priya 🙏" on its own line,
// then the message; other countries keep "Hi Priya, …". `rest` is written in lower case after "Hi Priya, ".
export function greet(name: string | null | undefined, rest: string, country: Country | null | undefined): string {
  const n = (name || '').trim()
  if ((country ?? 'IN') === 'IN') {
    const body = rest.charAt(0).toUpperCase() + rest.slice(1)
    return `Namaste${n && n !== 'there' ? ` ${n}` : ''} 🙏\n${body}`
  }
  return `Hi ${n || 'there'}, ${rest}`
}

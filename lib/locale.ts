// Country-driven formatting and rules. Set once per company (companies.country).
// Every screen should use these helpers instead of hard-coding 'en-IN' / 'en'.

export type Country = 'IN' | 'US'

export const COUNTRIES: { code: Country; label: string; currency: 'INR' | 'USD' }[] = [
  { code: 'IN', label: 'India', currency: 'INR' },
  { code: 'US', label: 'United States', currency: 'USD' },
]

// Anything unknown or empty is treated as India (the original default).
export function normalizeCountry(value: string | null | undefined): Country {
  return value === 'US' ? 'US' : 'IN'
}

export function currencyForCountry(country: Country): 'INR' | 'USD' {
  return country === 'US' ? 'USD' : 'INR'
}

const LOCALE: Record<Country, string> = { IN: 'en-IN', US: 'en-US' }

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

// India: clients log in with their 10-digit phone (stored as {phone}@getcoachboard.in).
// US: clients log in with email; phone is for contact only. US numbers are also
// 10 digits, so using them as logins would clash with Indian numbers.
export function loginMethod(country: Country): 'phone' | 'email' {
  return country === 'US' ? 'email' : 'phone'
}

// Country calling code for WhatsApp links (wa.me/<code><number>)
export function dialCode(country: Country): string {
  return country === 'US' ? '1' : '91'
}

export function phonePlaceholder(country: Country): string {
  return country === 'US' ? 'Phone, e.g. 555 123 4567' : 'Phone number (10 digits)'
}

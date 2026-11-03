// Phone numbers and phone logins for every country CoachBoard supports.
// One place for the login-identifier rule: never build `...@getcoachboard.in` inline.
//
// Login identifier (Supabase Auth email) for a phone login:
//   India (+91)        → 9876543210@getcoachboard.in     (unchanged, so existing logins keep working)
//   every other country → full digits with the country code:
//                         971501234567@getcoachboard.in (UAE), 15551234567@getcoachboard.in (US / Canada)
//
// Stored phones: clients are stored in international format (+919876543210, +971501234567)
// since db/2026-11-01-multi-country.md. Staff phones keep the format they were saved in:
// Indian staff as 10 digits, staff of other countries as +<code><digits>. Every reader goes through
// splitE164 / displayPhone / waDigits, which accept both formats.

export type PhoneCountry = 'IN' | 'AE' | 'US' | 'CA'

export const PHONE_COUNTRIES: Record<PhoneCountry, { label: string; dial: string; digits: number; currency: string; flag: string }> = {
  IN: { label: 'India', dial: '91', digits: 10, currency: 'INR', flag: '🇮🇳' },
  AE: { label: 'UAE', dial: '971', digits: 9, currency: 'AED', flag: '🇦🇪' },
  US: { label: 'United States', dial: '1', digits: 10, currency: 'USD', flag: '🇺🇸' },
  CA: { label: 'Canada', dial: '1', digits: 10, currency: 'CAD', flag: '🇨🇦' },
}

export const PHONE_COUNTRY_CODES = Object.keys(PHONE_COUNTRIES) as PhoneCountry[]

export const LOGIN_DOMAIN = '@getcoachboard.in'

// Anything unknown or empty is India (the original default)
export function phoneCountry(value: string | null | undefined): PhoneCountry {
  return value && value in PHONE_COUNTRIES ? (value as PhoneCountry) : 'IN'
}

// The local number (no country code) if it is the right length for that country, else null.
// Spaces and symbols are ignored; a leading 0 (trunk prefix, India / UAE) or the country code itself is tolerated.
export function validLocalDigits(country: PhoneCountry, raw: string | null | undefined): string | null {
  const { dial, digits: len } = PHONE_COUNTRIES[country]
  let d = (raw || '').replace(/\D/g, '')
  if (d.length === len + dial.length && d.startsWith(dial)) d = d.slice(dial.length)
  else if (d.length === len + 1 && d.startsWith('0')) d = d.slice(1)
  return d.length === len ? d : null
}

// The login identifier for a phone login (see the rule at the top)
export function loginEmailFor(country: PhoneCountry, localDigits: string): string {
  return country === 'IN' ? `${localDigits}${LOGIN_DOMAIN}` : `${PHONE_COUNTRIES[country].dial}${localDigits}${LOGIN_DOMAIN}`
}

// True for logins made from a phone number (any country), false for real email logins
// and for generated child logins (below), which share the domain but aren't phones.
export function isPhoneLogin(email: string | null | undefined): boolean {
  return !!email && email.endsWith(LOGIN_DOMAIN) && !isGeneratedLogin(email)
}

// Child students added with no phone of their own (Dojo Build 1, #53): the parent's phone is contact only, never a login,
// so siblings can share it. The server (create-user) gives the child student-<8 random a–z / 0–9>@getcoachboard.in and a
// random 16-character password nobody knows. Not a phone login (isPhoneLogin is false, so update-client never moves it)
// and counts as "no login" on every screen (isNoLogin); Super Admin shows it as "No login (child)". Never shown anywhere.
const GENERATED_LOGIN = /^student-[a-z0-9]{8}@getcoachboard\.in$/

export function generatedStudentLogin(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(8)
  globalThis.crypto.getRandomValues(bytes)
  return `student-${Array.from(bytes, b => chars[b % chars.length]).join('')}${LOGIN_DOMAIN}`
}

export function isGeneratedLogin(email: string | null | undefined): boolean {
  return !!email && GENERATED_LOGIN.test(email)
}

// Clients added without a login (the coach enters everything and shares progress themselves).
// Every profile needs a Supabase Auth user, so the server gives them a placeholder nobody can sign in with:
// client-<random>@nologin.getcoachboard.in and a random password (made in create-user, never shown).
// Giving the client a real login later = change that user's email / password.
export const NO_LOGIN_DOMAIN = '@nologin.getcoachboard.in'

export function isNoLogin(email: string | null | undefined): boolean {
  return !!email && (email.endsWith(NO_LOGIN_DOMAIN) || isGeneratedLogin(email))
}

// The email to show for a client: '' for a no-login placeholder
export function shownEmail(email: string | null | undefined): string {
  return email && !isNoLogin(email) ? email : ''
}

// +<code><digits>, e.g. +919876543210
export function toE164(country: PhoneCountry, localDigits: string): string {
  return `+${PHONE_COUNTRIES[country].dial}${localDigits}`
}

// Reads a stored phone (+E.164, or the old bare local format) into country + local digits.
// homeCountry is used for bare numbers and to tell the US and Canada apart (both +1).
// null when it isn't a phone number of a supported country.
export function splitE164(phone: string | null | undefined, homeCountry: string | null | undefined): { country: PhoneCountry; local: string } | null {
  const raw = (phone || '').trim()
  if (!raw) return null
  const home = phoneCountry(homeCountry)
  if (!raw.startsWith('+')) {
    const local = validLocalDigits(home, raw)
    return local ? { country: home, local } : null
  }
  const d = raw.replace(/\D/g, '')
  // Longest code first (971 before 91 / 1); +1 is the US unless the home country is Canada
  const candidates = [...PHONE_COUNTRY_CODES].sort((a, b) => PHONE_COUNTRIES[b].dial.length - PHONE_COUNTRIES[a].dial.length)
  for (const c of candidates) {
    const { dial, digits } = PHONE_COUNTRIES[c]
    if (d.startsWith(dial) && d.length === dial.length + digits) {
      const country: PhoneCountry = dial === '1' ? (home === 'CA' ? 'CA' : 'US') : c
      return { country, local: d.slice(dial.length) }
    }
  }
  return null
}

// How a phone is shown: numbers from the gym's own country exactly as before (local digits),
// numbers from another country with their code ("+971 501234567"). Unreadable values are shown as saved.
export function displayPhone(phone: string | null | undefined, homeCountry: string | null | undefined): string {
  if (!phone) return ''
  const parts = splitE164(phone, homeCountry)
  if (!parts) return phone
  const home = phoneCountry(homeCountry)
  if (PHONE_COUNTRIES[parts.country].dial === PHONE_COUNTRIES[home].dial) return parts.local
  return `+${PHONE_COUNTRIES[parts.country].dial} ${parts.local}`
}

// Digits for a wa.me link (country code + number). India and US / Canada numbers only:
// WhatsApp for other countries is not set up yet, so null (the button then opens the client instead).
export function waDigits(phone: string | null | undefined, homeCountry: string | null | undefined): string | null {
  const parts = splitE164(phone, homeCountry)
  if (!parts || parts.country === 'AE') return null
  return PHONE_COUNTRIES[parts.country].dial + parts.local
}

// The value saved for a client's phone: +<code><digits> when it is a valid number for that country,
// otherwise what was typed (trimmed), so nothing that was accepted before is rejected now. '' = no phone.
export function clientPhoneValue(country: PhoneCountry, raw: string | null | undefined): string {
  const local = validLocalDigits(country, raw)
  return local ? toE164(country, local) : (raw || '').trim()
}

// The value saved for a staff phone (coach / partner): India as 10 digits (as always), other countries +<code><digits>
export function staffPhoneValue(country: PhoneCountry, localDigits: string): string {
  return country === 'IN' ? localDigits : toE164(country, localDigits)
}

export function phoneHint(country: PhoneCountry): string {
  const { digits } = PHONE_COUNTRIES[country]
  return `${digits} digits`
}

// Staff logins (owner, partner, coach). India: the phone is the login (password = the number), as always.
// Other countries: an email login (email + password, as US staff today) or, with no email, the phone with its
// country code (password = the number).
export function staffLogin(
  homeCountry: string | null | undefined,
  input: { phoneCountry: PhoneCountry; phone: string; email?: string; password?: string },
): { email: string; password: string; phone: string | null; method: 'phone' | 'email' } | { error: string } {
  const home = phoneCountry(homeCountry)
  const email = (input.email || '').trim().toLowerCase()
  const typedPhone = input.phone.trim()
  const local = validLocalDigits(input.phoneCountry, typedPhone)
  if (home !== 'IN' && email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email' }
    if ((input.password || '').length < 6) return { error: 'Password must be at least 6 characters' }
    if (typedPhone && !local) return { error: `Enter a valid phone number (${phoneHint(input.phoneCountry)}), or leave it empty` }
    return { email, password: input.password!, phone: local ? staffPhoneValue(input.phoneCountry, local) : null, method: 'email' }
  }
  if (!local) {
    return { error: home === 'IN'
      ? `Enter a valid phone number (${phoneHint(input.phoneCountry)})`
      : `Enter an email, or a valid phone number (${phoneHint(input.phoneCountry)}) to log in with` }
  }
  return { email: loginEmailFor(input.phoneCountry, local), password: local, phone: staffPhoneValue(input.phoneCountry, local), method: 'phone' }
}

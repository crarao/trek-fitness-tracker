// Server-side login rules for create-user / create-login (the server is the source of truth; the forms check too).
// Pure functions, no Supabase: checked by scripts/check-login-rules.ts.
import { normalizeCountry } from './locale'

export const MIN_PASSWORD = 6

// Our own login domains: getcoachboard.in and every subdomain (user., nologin., …). Phone, username, no-login and
// generated child logins live there and are built only by the server (lib/phone.ts), never typed in as an email.
const OWN_DOMAIN = /(^|\.)getcoachboard\.in$/i

export function normalizeEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

export function isOwnDomain(email: string): boolean {
  const at = email.lastIndexOf('@')
  return at >= 0 && OWN_DOMAIN.test(email.slice(at + 1))
}

// null when the (already normalised) email is fine for a client email login, else the message
export function clientEmailProblem(email: string): string | null {
  if (!email) return 'Enter an email, a username, or add the member without a login'
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email'
  if (isOwnDomain(email)) return 'That email can\'t be used for a login. Use the client\'s own email or a username'
  return null
}

export function passwordProblem(password: unknown): string | null {
  return typeof password === 'string' && password.length >= MIN_PASSWORD ? null : `Password must be at least ${MIN_PASSWORD} characters`
}

// Email logins for clients follow the Add form: no username given and the client's country isn't India
// (India: username or no login; lib/locale.ts loginMethod). Country = the client's own, else the gym's (default IN).
export function clientEmailAllowed(clientCountry: unknown, gymCountry: unknown): boolean {
  const c = typeof clientCountry === 'string' && clientCountry ? clientCountry : (gymCountry as string | null | undefined)
  return normalizeCountry(c) !== 'IN'
}

// Supabase Auth's error turned into a plain message (the raw one goes to the server log only)
export function authErrorMessage(message: string): string {
  if (/already (been )?registered|already exists|duplicate/i.test(message)) return 'That login is already used by someone else'
  if (/password/i.test(message)) return `Password must be at least ${MIN_PASSWORD} characters`
  if (/email/i.test(message)) return 'Enter a valid email'
  return 'Couldn\'t create the login. Check the details and try again'
}

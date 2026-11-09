// Shared fixture for the smoke tests (CLAUDE.md → Smoke tests).
// Every test gets:
//  1. a WRITE GUARD — smoke tests run against production, so anything that would change data is aborted
//     and the test fails, listing each blocked request (a page that writes just by being opened shows up here);
//  2. a console / page error check (fails on any console error or uncaught exception);
//  3. a bad response check (any 5xx; 401 / 403 from Supabase rest/v1 = an RLS or auth break).
import { test as base, expect, type Page } from '@playwright/test'

// Known console noise to ignore, for every test. Keep it empty unless a message is understood and harmless;
// add a regex with a comment saying why. A single test can allow one more pattern with test.use({ allowedConsoleErrors: /.../ }).
export const CONSOLE_ALLOW_LIST: RegExp[] = []

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// May this request go through? Reads always; POST only to read-only RPCs and to Supabase Auth (login / logout)
export function isAllowedRequest(method: string, url: string): boolean {
  const m = method.toUpperCase()
  if (READ_METHODS.has(m)) return true
  const { pathname } = new URL(url)
  if (m === 'POST' && pathname.includes('/rest/v1/rpc/')) return true
  if (m === 'POST' && pathname.includes('/auth/v1/')) return true
  return false
}

type Fixtures = {
  allowedConsoleErrors: RegExp | undefined
  guard: { blocked: string[]; errors: string[]; badResponses: string[] }
}

export const test = base.extend<Fixtures>({
  // One regex, not an array: test.use() reads an array value as [value, options]
  allowedConsoleErrors: [undefined, { option: true }],

  guard: [async ({ page, allowedConsoleErrors }, use, testInfo) => {
    const blocked: string[] = []
    const errors: string[] = []
    const badResponses: string[] = []
    const allow = allowedConsoleErrors ? [...CONSOLE_ALLOW_LIST, allowedConsoleErrors] : CONSOLE_ALLOW_LIST

    // 1. Write guard
    for (const pattern of ['**/rest/v1/**', '**/api/**', '**/storage/v1/**']) {
      await page.route(pattern, route => {
        const req = route.request()
        if (isAllowedRequest(req.method(), req.url())) return route.fallback()
        blocked.push(`${req.method()} ${req.url()}`)
        return route.abort('blockedbyclient')
      })
    }

    // 2. Console errors and uncaught exceptions
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`))
    page.on('console', msg => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      const where = msg.location()?.url ? ` (${msg.location().url})` : ''
      if (allow.some(re => re.test(text) || re.test(where))) return
      errors.push(`console.error: ${text}${where}`)
    })

    // 3. Bad responses
    page.on('response', res => {
      const status = res.status()
      const url = res.url()
      if (status >= 500) badResponses.push(`${status} ${res.request().method()} ${url}`)
      else if ((status === 401 || status === 403) && url.includes('/rest/v1/')) {
        badResponses.push(`${status} ${res.request().method()} ${url} (RLS / auth break?)`)
      }
    })

    await use({ blocked, errors, badResponses })

    const problems: string[] = []
    if (blocked.length) problems.push(`Blocked writes (smoke tests must never write):\n  ${blocked.join('\n  ')}`)
    if (errors.length) problems.push(`Console / page errors:\n  ${errors.join('\n  ')}`)
    if (badResponses.length) problems.push(`Bad responses:\n  ${badResponses.join('\n  ')}`)
    if (problems.length) {
      await testInfo.attach('guard-report', { body: problems.join('\n\n'), contentType: 'text/plain' })
      throw new Error(problems.join('\n\n'))
    }
  }, { auto: true }],
})

export { expect }

// ---------- Addresses ----------

function baseUrl(): URL {
  const raw = process.env.E2E_BASE_URL
  if (!raw) throw new Error('E2E_BASE_URL is not set (e.g. https://www.getcoachboard.com or http://localhost:3000)')
  return new URL(raw)
}

// The main site's host without "www." (www.getcoachboard.com → getcoachboard.com; localhost:3000 stays)
export function rootHost(): string {
  return baseUrl().host.replace(/^www\./, '')
}

// A gym's own address: gymUrl('qagym', '/login') → https://qagym.getcoachboard.com/login
// (locally http://qagym.localhost:3000/login, which lib/tenant.ts reads the same way)
export function gymUrl(slug: string, path = '/'): string {
  const u = baseUrl()
  return `${u.protocol}//${slug}.${rootHost()}${path}`
}

// ---------- Logins ----------

export type Role = 'gymOwner' | 'gymPartner' | 'gymCoach' | 'soloOwner' | 'dojoOwner' | 'dojoSensei'

export const ROLE_GYM: Record<Role, string> = {
  gymOwner: 'qagym', gymPartner: 'qagym', gymCoach: 'qagym',
  soloOwner: 'qasolo',
  dojoOwner: 'qadojo', dojoSensei: 'qadojo',
}

export const ROLE_HOME: Record<Role, string> = {
  gymOwner: '/company', gymPartner: '/company', gymCoach: '/coach',
  soloOwner: '/company',
  dojoOwner: '/company', dojoSensei: '/coach',
}

export type Login = { id: string; password: string }

// QA_LOGINS = JSON: { "gymOwner": { "id": "<phone or email>", "password": "..." }, "gymCoach": {...}, ... }
// Also accepted per role: "phone" / "email" / "identifier" / "login" / "username" for the id, "pass" / "pw" for the
// password, or a pair ["<id>", "<password>"].
const ID_KEYS = ['id', 'identifier', 'phone', 'email', 'login', 'username', 'user']
const PASSWORD_KEYS = ['password', 'pass', 'pw']

export function qaLogin(role: Role): Login {
  const raw = process.env.QA_LOGINS
  if (!raw) throw new Error('QA_LOGINS is not set. Put it in .env.e2e locally, or the QA_LOGINS secret in GitHub Actions.')
  let all: Record<string, unknown>
  try {
    all = JSON.parse(raw)
  } catch {
    throw new Error('QA_LOGINS is not valid JSON (one line, straight quotes). Expected {"gymOwner":{"id":"…","password":"…"}, …}')
  }
  const entry = all[role]
  if (entry == null) {
    throw new Error(`QA_LOGINS has no "${role}" login. Roles found: ${Object.keys(all).join(', ') || 'none'}`)
  }
  if (Array.isArray(entry) && entry.length >= 2 && entry[0] && entry[1]) {
    return { id: String(entry[0]), password: String(entry[1]) }
  }
  const obj = (typeof entry === 'object' ? entry : {}) as Record<string, unknown>
  const pick = (keys: string[]) => keys.map(k => obj[k]).find(v => v != null && String(v).trim() !== '')
  const id = pick(ID_KEYS)
  const password = pick(PASSWORD_KEYS)
  if (!id || !password) {
    // Field names only, never values
    throw new Error(`QA_LOGINS "${role}" needs an id (${ID_KEYS.join(' / ')}) and a password (${PASSWORD_KEYS.join(' / ')}). ` +
      `Fields found: ${Object.keys(obj).join(', ') || 'none'}`)
  }
  return { id: String(id).trim(), password: String(password) }
}

// Fill the login form on whatever /login page is open and press Sign In
export async function submitLogin(page: Page, id: string, password: string) {
  await page.getByTestId('login-identifier').fill(id)
  await page.getByTestId('login-password').fill(password)
  await page.getByTestId('login-submit').click()
}

// Log in as a QA role on that role's gym address and wait for the role's home page
export async function loginAs(page: Page, role: Role) {
  const { id, password } = qaLogin(role)
  await page.goto(gymUrl(ROLE_GYM[role], '/login'))
  await submitLogin(page, id, password)
  const home = ROLE_HOME[role]
  await page.waitForURL(url => url.pathname === home, { timeout: 30_000 })
}

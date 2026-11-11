// Shared fixture for the regression suite (CLAUDE.md → Regression tests). These tests WRITE to the dev project.
// Every browser context a test opens gets:
//  1. a PROJECT GUARD: any request to a Supabase project other than dev is aborted and fails the test;
//  2. a NO-DELETE GUARD (CLAUDE.md Rule #1): any DELETE to Supabase, and the delete-user / delete-company APIs,
//     are aborted and fail the test. Tests archive what they create instead;
//  3. MOCKED AI: /api/generate-plan answers with a fixed plan (no Anthropic call); the other AI routes are blocked;
//  4. the smoke tests' checks: console errors / uncaught exceptions, any 5xx.
import { test as base, expect, devices, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { CONSOLE_ALLOW_LIST } from '../e2e/fixtures'
import { checkTarget, isForeignSupabase } from './target'
import { newRoleContext, token, type Role } from './session'

const { supabaseUrl } = checkTarget()

// ---------- Names ----------

// Every record a test creates starts with "E2E <timestamp>", so global teardown can archive leftovers and it is
// never mistaken for the seeded QA data (QA Active, QA PT, …), which tests only read.
export const STAMP = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) // 20261111T143201
let seq = 0
export const e2eName = (what: string) => `E2E ${STAMP} ${what} ${++seq}`

// ---------- The fixed AI plan (mocked /api/generate-plan) ----------

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
// Every day a workout day, so "today" always has one whatever day the suite runs
export const MOCK_PLAN_JSON = {
  version: 1,
  days: WEEK.map(day => ({
    day, rest: false, focus: 'E2E Full Body',
    exercises: [
      { name: 'Squat', sets: '3', reps: '10', rest: '60 s', note: '' },
      { name: 'Push-up', sets: '3', reps: '12', rest: '60 s', note: '' },
    ],
  })),
  note: 'E2E mocked plan.',
}
const MOCK_PLAN_TEXT = WEEK.map(d => `${d} – E2E Full Body\n- Squat – 3×10\n- Push-up – 3×12`).join('\n\n')

// ---------- Guard ----------

export type Report = { blocked: string[]; errors: string[]; badResponses: string[]; aiMocked: number; refused: string[] }

async function guardContext(context: BrowserContext, report: Report, allow: RegExp[]) {
  const bypass = process.env.E2E_VERCEL_BYPASS
  const appHost = new URL(checkTarget().baseUrl).host
  // Vercel deployment protection: the bypass header goes to the app's own host only (never to Supabase)
  if (bypass) {
    await context.route(url => url.host === appHost, route =>
      route.fallback({ headers: { ...route.request().headers(), 'x-vercel-protection-bypass': bypass } }))
  }
  // 1. Any Supabase project but dev
  await context.route(url => isForeignSupabase(url.href), route => {
    report.blocked.push(`NOT THE DEV PROJECT: ${route.request().method()} ${route.request().url()}`)
    return route.abort('blockedbyclient')
  })
  // 2. No deletes
  await context.route(url => url.href.startsWith(supabaseUrl), route => {
    const req = route.request()
    if (req.method() === 'DELETE') {
      report.blocked.push(`DELETE (Rule #1): ${req.url()}`)
      return route.abort('blockedbyclient')
    }
    return route.fallback()
  })
  await context.route(/\/api\/(delete-user|delete-company)(\?|$)/, route => {
    report.blocked.push(`Delete API (Rule #1): ${route.request().url()}`)
    return route.abort('blockedbyclient')
  })
  // 3. AI: plan generation mocked, the rest blocked
  await context.route(/\/api\/generate-plan(\?|$)/, route => {
    report.aiMocked++
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ plan: MOCK_PLAN_TEXT, plan_json: MOCK_PLAN_JSON, aiPlans: null, scheduleNotes: [] }) })
  })
  await context.route(/\/api\/(generate-diet|ai-insights)(\?|$)/, route => {
    report.blocked.push(`Real AI call (not mocked): ${route.request().url()}`)
    return route.abort('blockedbyclient')
  })

  // 4. Console errors, page errors, 5xx (per page)
  const watch = (page: Page) => {
    page.on('pageerror', err => report.errors.push(`pageerror: ${err.message}`))
    page.on('console', msg => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      const where = msg.location()?.url ? ` (${msg.location().url})` : ''
      // An aborted request (the guards above) is already reported as blocked
      if (/ERR_BLOCKED_BY_CLIENT/.test(text)) return
      if ([...CONSOLE_ALLOW_LIST, ...allow].some(re => re.test(text) || re.test(where))) return
      report.errors.push(`console.error: ${text}${where}`)
    })
    page.on('response', async res => {
      if (res.status() >= 500) report.badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`)
      // A refused Supabase request: keep the database's own message and who the token was (for diagnosis)
      if (res.status() >= 400 && res.status() < 500 && res.url().includes('/rest/v1/')) {
        const auth = res.request().headers().authorization || ''
        let who = 'no token'
        try {
          const c = JSON.parse(Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString())
          who = `sub ${c.sub ?? '-'} role ${c.role} session ${c.session_id ?? '-'} exp ${c.exp ? new Date(c.exp * 1000).toISOString() : '-'}`
        } catch { /* not a JWT */ }
        const body = (await res.text().catch(() => '')).slice(0, 300)
        report.refused.push(`${res.status()} ${res.request().method()} ${res.url().split('?')[0]} [${who}] ${body}`)
      }
    })
    page.on('dialog', d => d.accept()) // Archive asks "Archive X?" with confirm(); Delete is never clicked
  }
  context.pages().forEach(watch)
  context.on('page', watch)
}

type Fixtures = {
  allowedConsoleErrors: RegExp | undefined
  report: Report
  // A phone-sized page logged in as a QA role (saved login from global setup, no new sign-in)
  as: (role: Role) => Promise<Page>
}

export const test = base.extend<Fixtures>({
  allowedConsoleErrors: [undefined, { option: true }],

  report: [async ({ context, allowedConsoleErrors }, provide, testInfo) => {
    const report: Report = { blocked: [], errors: [], badResponses: [], aiMocked: 0, refused: [] }
    await guardContext(context, report, allowedConsoleErrors ? [allowedConsoleErrors] : [])
    await provide(report)
    const problems: string[] = []
    if (report.blocked.length) problems.push(`Blocked requests:\n  ${report.blocked.join('\n  ')}`)
    if (report.errors.length) problems.push(`Console / page errors:\n  ${report.errors.join('\n  ')}`)
    if (report.badResponses.length) problems.push(`Bad responses:\n  ${report.badResponses.join('\n  ')}`)
    if (report.refused.length) {
      await testInfo.attach('refused-requests', { body: report.refused.join('\n'), contentType: 'text/plain' })
      if (testInfo.status !== testInfo.expectedStatus || problems.length) console.log(`Refused Supabase requests in "${testInfo.title}":\n  ${report.refused.join('\n  ')}`)
    }
    if (problems.length) {
      await testInfo.attach('guard-report', { body: problems.join('\n\n'), contentType: 'text/plain' })
      throw new Error(problems.join('\n\n'))
    }
  }, { auto: true }],

  as: async ({ browser, report, allowedConsoleErrors }, provide) => {
    const opened: BrowserContext[] = []
    await provide(async (role: Role) => {
      const context = await newRoleContext(browser as Browser, role, { ...devices['Pixel 7'], baseURL: checkTarget().baseUrl, timezoneId: 'Asia/Kolkata' })
      await guardContext(context, report, allowedConsoleErrors ? [allowedConsoleErrors] : [])
      opened.push(context)
      return context.newPage()
    })
    for (const c of opened) await c.close()
  },
})

export { expect }

// ---------- Talking to dev Supabase directly, as a role ----------
// With that role's own token, so RLS applies exactly as in the browser. Used to set up records, to read ids,
// and for the isolation checks. Only ever the dev project (supabaseUrl was checked at start-up).

export type Rest = {
  userId: string
  get: <T = Record<string, unknown>>(pathAndQuery: string) => Promise<{ status: number; rows: T[] }>
  patch: <T = Record<string, unknown>>(pathAndQuery: string, body: object) => Promise<{ status: number; rows: T[] }>
  post: <T = Record<string, unknown>>(pathAndQuery: string, body: object) => Promise<{ status: number; rows: T[] }>
}

export function rest(role: Role): Rest {
  const t = token(role)
  const call = async (method: string, p: string, body?: object) => {
    const url = `${supabaseUrl}/rest/v1/${p}`
    if (isForeignSupabase(url)) throw new Error('Refused: not the dev project')
    const res = await fetch(url, {
      method,
      headers: {
        apikey: t.apikey, authorization: t.authorization, 'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let rows: unknown = []
    try { rows = text ? JSON.parse(text) : [] } catch { rows = [] }
    return { status: res.status, rows: Array.isArray(rows) ? rows : [] }
  }
  return {
    userId: t.userId,
    get: p => call('GET', p) as never,
    patch: (p, b) => call('PATCH', p, b) as never,
    post: (p, b) => call('POST', p, b) as never,
  }
}

// One seeded record by exact name, read as a role that can see it (fails loudly if the seed is missing)
export async function seeded(role: Role, table: string, name: string, nameColumn = 'full_name'): Promise<{ id: string; company_id: string }> {
  const { rows } = await rest(role).get<{ id: string; company_id: string }>(
    `${table}?select=id,company_id&${nameColumn}=eq.${encodeURIComponent(name)}&limit=2`)
  if (rows.length !== 1) throw new Error(`Seeded ${table} "${name}" not found as ${role} (rows: ${rows.length}). Re-create the QA data on dev.`)
  return rows[0]
}

// The role's own company id
export async function myCompanyId(role: Role): Promise<string> {
  const r = rest(role)
  const { rows } = await r.get<{ company_id: string }>(`profiles?select=company_id&id=eq.${r.userId}`)
  if (!rows[0]?.company_id) throw new Error(`No company for ${role}`)
  return rows[0].company_id
}

// Call one of the app's /api routes from the logged-in page (cookies = that role)
export async function callApi(page: Page, route: string, body: object): Promise<{ status: number; json: Record<string, unknown> }> {
  return page.evaluate(async ([r, b]) => {
    const res = await fetch(r as string, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    let json = {}
    try { json = await res.json() } catch { /* empty */ }
    return { status: res.status, json }
  }, [route, body] as const)
}

// Add a member through the app's own API, as the given (logged-in) staff page. No login, no membership.
export async function createMember(page: Page, companyId: string, fullName: string, extra: object = {}): Promise<string> {
  const { status, json } = await callApi(page, '/api/create-user', {
    no_login: true, full_name: fullName, company_id: companyId, role: 'client', phone: null, ...extra,
  })
  if (status !== 200 || !json.userId) throw new Error(`create-user failed (${status}): ${JSON.stringify(json)}`)
  return json.userId as string
}

// Archive (never delete) a member this suite created
export async function archiveMember(role: Role, id: string) {
  await rest(role).patch(`profiles?id=eq.${id}&full_name=like.E2E*`, { archived_at: new Date().toISOString() })
}
